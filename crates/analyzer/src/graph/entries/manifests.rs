//! The entry points manifests declare: the `main`, `bin`, `exports` and
//! scripts of a `package.json`, and the scripts of a `pyproject.toml` or a
//! `setup.cfg`.

use std::collections::HashMap;

use model::EntryReason;
use serde_json::Value;

/// Extensions tried after a path given without one, as Node does.
const EXTENSIONS: &[&str] = &[".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs", ".cjs"];

/// Folders a `package.json` points into for its built code; the source is
/// looked for under `src/` instead.
const BUILT: &[&str] = &["build", "dist", "out"];

/// The files a `package.json` in `dir` names as entry points.
pub(super) fn package_json(
    dir: &str,
    content: &[u8],
    by_path: &HashMap<&str, u32>,
    production: &dyn Fn(u32) -> bool,
) -> Vec<(u32, EntryReason, u32, Option<String>)> {
    let Ok(manifest) = serde_json::from_slice::<Value>(content) else {
        return Vec::new();
    };
    let locate = |spec: &str| locate_script(dir, spec, by_path, production);
    let mut found = Vec::new();
    // `@scope/name` runs as `name`
    let package = manifest
        .get("name")
        .and_then(Value::as_str)
        .map(|name| name.rsplit('/').next().unwrap_or(name).to_owned());
    match manifest.get("bin") {
        Some(Value::String(spec)) => {
            found.extend(
                locate(spec).map(|file| (file, EntryReason::PackageBin, 5, package.clone())),
            );
        }
        Some(Value::Object(commands)) => {
            for (command, spec) in commands {
                if let Some(file) = spec.as_str().and_then(locate) {
                    found.push((file, EntryReason::PackageBin, 5, Some(command.clone())));
                }
            }
        }
        _ => {}
    }
    let mut mains: Vec<&str> = ["main", "module"]
        .iter()
        .filter_map(|field| manifest.get(field)?.as_str())
        .collect();
    if let Some(exports) = manifest.get("exports") {
        let root = match exports {
            Value::Object(map) if map.keys().any(|key| key.starts_with('.')) => map.get("."),
            other => Some(other),
        };
        mains.extend(root.and_then(condition));
    }
    for spec in mains {
        found.extend(locate(spec).map(|file| (file, EntryReason::PackageMain, 5, None)));
    }
    if let Some(Value::Object(scripts)) = manifest.get("scripts") {
        for name in ["start", "dev", "serve"] {
            let Some(script) = scripts.get(name).and_then(Value::as_str) else {
                continue;
            };
            if let Some(file) = run_target(script).and_then(locate) {
                found.push((file, EntryReason::PackageScript, 4, None));
            }
        }
    }
    found
}

/// The path an `exports` entry leads to, through its conditions: those a
/// program runs with first, types left out.
fn condition(value: &Value) -> Option<&str> {
    match value {
        Value::String(path) => Some(path),
        Value::Array(choices) => choices.iter().find_map(condition),
        Value::Object(conditions) => ["import", "require", "node", "default"]
            .iter()
            .find_map(|key| conditions.get(*key).and_then(condition))
            .or_else(|| {
                conditions
                    .iter()
                    .filter(|(key, _)| !key.starts_with("types"))
                    .find_map(|(_, value)| condition(value))
            }),
        _ => None,
    }
}

/// Options of `node`, `tsx` and `ts-node` that take the next word as their
/// value, unless written `--option=value`.
const VALUE_OPTIONS: &[&str] = &[
    "-r",
    "--require",
    "--import",
    "--loader",
    "--experimental-loader",
    "--env-file",
    "-C",
    "--conditions",
    "--tsconfig",
    "-P",
    "--project",
    "-O",
    "--compiler-options",
];

/// The file a script runs with `node`, `tsx` or `ts-node`, past their
/// options and `tsx watch`; `None` when it evaluates code instead.
fn run_target(script: &str) -> Option<&str> {
    let mut words = script.split_whitespace();
    while let Some(word) = words.next() {
        if !matches!(word, "node" | "tsx" | "ts-node") {
            continue;
        }
        let mut first = true;
        while let Some(word) = words.next() {
            match word {
                "watch" if first => {}
                "-e" | "--eval" | "-p" | "--print" => return None,
                "&&" | "||" | ";" | "|" => break,
                option if VALUE_OPTIONS.contains(&option) => {
                    words.next();
                }
                option if option.starts_with('-') => {}
                file => return Some(file),
            }
            first = false;
        }
    }
    None
}

/// The production file a manifest in `dir` points to with `spec`: as
/// written, with its extension swapped (TypeScript compiled next to its
/// source: `index.js` is `index.ts`) or one added, as a folder's index,
/// then, for built code, the file of the same name under `src/`.
fn locate_script(
    dir: &str,
    spec: &str,
    by_path: &HashMap<&str, u32>,
    production: &dyn Fn(u32) -> bool,
) -> Option<u32> {
    let relative = normalize(spec)?;
    let found = |path: &str| {
        let path = join(dir, path);
        let stem = EXTENSIONS
            .iter()
            .find_map(|extension| path.strip_suffix(extension))
            .unwrap_or(&path);
        std::iter::once(path.clone())
            .chain(
                EXTENSIONS
                    .iter()
                    .map(|extension| format!("{stem}{extension}")),
            )
            .chain(
                EXTENSIONS
                    .iter()
                    .map(|extension| format!("{path}{extension}")),
            )
            .chain(
                EXTENSIONS
                    .iter()
                    .map(|extension| format!("{path}/index{extension}")),
            )
            .find_map(|candidate| by_path.get(candidate.as_str()).copied())
            .filter(|&file| production(file))
    };
    found(&relative).or_else(|| {
        let (first, rest) = relative.split_once('/')?;
        if !BUILT.contains(&first) {
            return None;
        }
        // `found` swaps the extension of the file, and only of the file
        found(&format!("src/{rest}"))
    })
}

/// A path relative to its manifest, without `./` or `..`; `None` when it
/// leaves the package or is absolute.
fn normalize(spec: &str) -> Option<String> {
    let mut parts: Vec<&str> = Vec::new();
    for part in spec.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            part => parts.push(part),
        }
    }
    (!spec.starts_with('/') && !parts.is_empty()).then(|| parts.join("/"))
}

pub(super) fn join(dir: &str, path: &str) -> String {
    if dir.is_empty() {
        path.to_owned()
    } else {
        format!("{dir}/{path}")
    }
}

/// Scripts of a `pyproject.toml`, as (command, `module:function`):
/// `[project.scripts]` and `[tool.poetry.scripts]`, or under `[project]`
/// an inline `scripts = { … }` or dotted `scripts.name = …` keys. Comments
/// after a header or a value are ignored.
pub(super) fn pyproject_scripts(content: &[u8]) -> Vec<(String, String)> {
    let text = String::from_utf8_lossy(content);
    let mut scripts = Vec::new();
    let mut section = String::new();
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            let header = line.split('#').next().unwrap_or_default().trim();
            section = header.chars().filter(|c| !c.is_whitespace()).collect();
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = unquote(key);
        match section.as_str() {
            "[project.scripts]" | "[tool.poetry.scripts]" => {
                scripts.extend(quoted(value).map(|target| (key, target)));
            }
            "[project]" if key == "scripts" => {
                // One inline table on one line: `{ a = "m:f", b = "n:g" }`
                let table = value.trim().trim_start_matches('{');
                let table = table.split('}').next().unwrap_or_default();
                for pair in table.split(',') {
                    if let Some((command, target)) = pair.split_once('=') {
                        scripts.extend(quoted(target).map(|target| (unquote(command), target)));
                    }
                }
            }
            "[project]" => {
                if let Some(command) = key.strip_prefix("scripts.") {
                    let command = unquote(command);
                    scripts.extend(quoted(value).map(|target| (command, target)));
                }
            }
            _ => {}
        }
    }
    scripts
}

/// A TOML key without its quotes.
fn unquote(text: &str) -> String {
    text.trim()
        .trim_matches(|c| c == '"' || c == '\'')
        .to_owned()
}

/// The first quoted string of a TOML value, a comment after it ignored.
fn quoted(value: &str) -> Option<String> {
    let value = value.trim_start();
    let quote = value.chars().next().filter(|&c| c == '"' || c == '\'')?;
    let rest = &value[1..];
    rest.find(quote).map(|end| rest[..end].to_owned())
}

/// `console_scripts` of a `setup.cfg`, as (command, `module:function`).
pub(super) fn setup_cfg_scripts(content: &[u8]) -> Vec<(String, String)> {
    let text = String::from_utf8_lossy(content);
    let mut scripts = Vec::new();
    let mut section = "";
    let mut in_scripts = false;
    for raw in text.lines() {
        let line = raw.trim();
        if line.starts_with('[') {
            section = line;
            in_scripts = false;
            continue;
        }
        if section != "[options.entry_points]" {
            continue;
        }
        // configparser keeps blank lines inside a value
        if line.is_empty() {
            continue;
        }
        let indented = raw.starts_with([' ', '\t']);
        if !indented {
            in_scripts = false;
            if let Some((key, rest)) = line.split_once('=')
                && key.trim() == "console_scripts"
            {
                in_scripts = true;
                // A single script can follow on the same line
                if let Some((command, target)) = rest.split_once('=') {
                    scripts.push((command.trim().to_owned(), target.trim().to_owned()));
                }
            }
            continue;
        }
        if in_scripts && let Some((command, target)) = line.split_once('=') {
            scripts.push((command.trim().to_owned(), target.trim().to_owned()));
        }
    }
    scripts
}

/// The files the scripts of a Python manifest in `dir` run, with their
/// command: `harbor.cli:main` is `harbor/cli.py` or `harbor/cli/__init__.py`,
/// beside the manifest or under its `src/`.
pub(super) fn python_scripts(
    dir: &str,
    scripts: &[(String, String)],
    by_path: &HashMap<&str, u32>,
) -> Vec<(u32, String)> {
    scripts
        .iter()
        .filter_map(|(command, target)| {
            let module = target.split(':').next()?.trim().replace('.', "/");
            if module.is_empty() {
                return None;
            }
            let file = [dir.to_owned(), join(dir, "src")]
                .iter()
                .flat_map(|root| {
                    let base = if root.is_empty() {
                        module.clone()
                    } else {
                        format!("{root}/{module}")
                    };
                    [format!("{base}.py"), format!("{base}/__init__.py")]
                })
                .find_map(|path| by_path.get(path.as_str()).copied())?;
            Some((file, command.clone()))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_script_runs_the_first_file_after_its_runner() {
        assert_eq!(run_target("node ./bin/www"), Some("./bin/www"));
        assert_eq!(
            run_target("tsc && node --enable-source-maps dist/server.js"),
            Some("dist/server.js")
        );
        assert_eq!(run_target("vite"), None);
        assert_eq!(
            run_target("node -r dotenv/config dist/index.js"),
            Some("dist/index.js")
        );
        assert_eq!(run_target("tsx watch src/index.ts"), Some("src/index.ts"));
        assert_eq!(
            run_target("ts-node --project tsconfig.app.json --transpile-only src/main.ts"),
            Some("src/main.ts")
        );
        assert_eq!(
            run_target("node --env-file=.env server.js"),
            Some("server.js")
        );
        assert_eq!(run_target("node -e \"run()\""), None);
    }

    #[test]
    fn exports_lead_to_the_code_a_program_runs() {
        let exports: Value = serde_json::from_str(
            r#"{ "types": "./index.d.ts", "import": "./index.mjs", "require": "./index.cjs" }"#,
        )
        .unwrap();
        assert_eq!(condition(&exports), Some("./index.mjs"));
        let nested: Value =
            serde_json::from_str(r#"{ "node": { "default": "./node.js" } }"#).unwrap();
        assert_eq!(condition(&nested), Some("./node.js"));
    }

    #[test]
    fn paths_stay_inside_the_package() {
        assert_eq!(normalize("./lib/../index.js").as_deref(), Some("index.js"));
        assert_eq!(normalize("../outside.js"), None);
        assert_eq!(normalize("/abs.js"), None);
    }

    #[test]
    fn python_manifests_list_their_scripts() {
        let pyproject = b"[project]\nname = \"harbor\"\n\n[project.scripts]\nharbor = \"harbor.cli:main\"\n'dock' = 'harbor.dock:run'\n\n[tool.ruff]\nline = 1\n";
        assert_eq!(
            pyproject_scripts(pyproject),
            [
                ("harbor".to_owned(), "harbor.cli:main".to_owned()),
                ("dock".to_owned(), "harbor.dock:run".to_owned()),
            ]
        );
        let commented = b"[project.scripts] # commands\nharbor = \"harbor.cli:main\" # the CLI\n";
        assert_eq!(
            pyproject_scripts(commented),
            [("harbor".to_owned(), "harbor.cli:main".to_owned())]
        );
        let inline = b"[project]\nname = \"harbor\"\nscripts = { harbor = \"harbor.cli:main\", dock = 'harbor.dock:run' }\n";
        assert_eq!(
            pyproject_scripts(inline),
            [
                ("harbor".to_owned(), "harbor.cli:main".to_owned()),
                ("dock".to_owned(), "harbor.dock:run".to_owned()),
            ]
        );
        let dotted = b"[project]\nscripts.harbor = \"harbor.cli:main\"\n[tool.ruff]\nscripts.x = \"no:no\"\n";
        assert_eq!(
            pyproject_scripts(dotted),
            [("harbor".to_owned(), "harbor.cli:main".to_owned())]
        );
        let spaced = b"[options.entry_points]\nconsole_scripts =\n    harbor = harbor.cli:main\n\n    dock = harbor.dock:run\n";
        assert_eq!(setup_cfg_scripts(spaced).len(), 2);
        let setup_cfg = b"[metadata]\nname = harbor\n\n[options.entry_points]\nconsole_scripts =\n    harbor = harbor.cli:main\n    dock = harbor.dock:run\ngui_scripts =\n    view = harbor.view:main\n";
        assert_eq!(
            setup_cfg_scripts(setup_cfg),
            [
                ("harbor".to_owned(), "harbor.cli:main".to_owned()),
                ("dock".to_owned(), "harbor.dock:run".to_owned()),
            ]
        );
    }
}
