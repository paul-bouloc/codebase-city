//! Entry points: where the code starts. Manifests and conventions first,
//! the graph only to confirm them or, without them, to guess (P10).
//!
//! Each signal adds to a score; a file needs 4 to be kept, or, when none
//! has, the best three are. Every entry keeps the reasons it was found by.

use std::collections::{HashMap, HashSet};

use model::{Entries, EntryReason};
use serde_json::Value;

use crate::files::split_path;
use crate::graph::Node;
use crate::reach::{Reach, Units};

/// Entries kept at most.
const KEPT: usize = 5;

/// Score an entry needs to be kept when others have it.
const THRESHOLD: u32 = 4;

/// Kept when no file reaches [`THRESHOLD`].
const FALLBACK: usize = 3;

/// Extensions tried after a path given without one, as Node does.
const EXTENSIONS: &[&str] = &[".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs", ".cjs"];

/// Folders a `package.json` points into for its built code; the source is
/// looked for under `src/` instead.
const BUILT: &[&str] = &["build", "dist", "out"];

/// Names of entry points, without their extension.
const CONVENTIONAL: &[&str] = &["main", "index", "server", "app", "cli"];

/// Points of the graph signal, by rank among the files no one imports.
const NO_IMPORTER: &[u32] = &[3, 2, 2, 1, 1];

/// What the entry points are found from, by row in the result.
pub(crate) struct Input<'a> {
    /// Paths of the files, sorted, and of the folders (`""` for the root).
    pub paths: &'a [&'a str],
    pub dir_paths: &'a [&'a str],
    /// The manifests that kept their content, by path.
    pub manifests: &'a [(&'a str, &'a [u8])],
    /// Files that start a program (Go `func main`, Python `__main__` block).
    pub mains: &'a [bool],
    pub barrels: &'a [bool],
    pub units: &'a Units,
    pub reach: Option<&'a Reach>,
}

/// An entry point being scored.
#[derive(Default)]
struct Candidate {
    score: u32,
    reasons: Vec<(EntryReason, u32)>,
    command: Option<String>,
}

pub(crate) fn find(input: &Input<'_>) -> Entries {
    let by_path: HashMap<&str, u32> = input
        .paths
        .iter()
        .enumerate()
        .map(|(row, &path)| (path, crate::saturating_u32(row)))
        .collect();
    let production = |file: u32| input.units.of_file[file as usize].is_some();
    let mut candidates: HashMap<Node, Candidate> = HashMap::new();
    let mut add = |node: Node, reason: EntryReason, points: u32, command: Option<String>| {
        let candidate = candidates.entry(node).or_default();
        if candidate.reasons.iter().any(|&(known, _)| known == reason) {
            return;
        }
        candidate.score += points;
        candidate.reasons.push((reason, points));
        if candidate.command.is_none() {
            candidate.command = command;
        }
    };

    for &(path, content) in input.manifests {
        let (dir, name) = split_path(path);
        let found: Vec<(u32, EntryReason, u32, Option<String>)> = match name {
            "package.json" => package_json(dir, content, &by_path, &production),
            "pyproject.toml" => python_scripts(dir, &pyproject_scripts(content), &by_path)
                .into_iter()
                .map(|(file, command)| (file, EntryReason::PyprojectScript, 5, Some(command)))
                .collect(),
            "setup.cfg" => python_scripts(dir, &setup_cfg_scripts(content), &by_path)
                .into_iter()
                .map(|(file, command)| (file, EntryReason::SetupCfgScript, 5, Some(command)))
                .collect(),
            _ => Vec::new(),
        };
        for (file, reason, points, command) in found {
            if production(file) {
                add(Node::File(file), reason, points, command);
            }
        }
    }

    // Folders at the root of a package, where conventional names count
    let mut roots: HashSet<String> = HashSet::from([String::new(), "src".to_owned()]);
    for &(path, _) in input.manifests {
        let (dir, name) = split_path(path);
        if matches!(
            name,
            "package.json" | "pyproject.toml" | "setup.cfg" | "go.mod"
        ) {
            roots.insert(dir.to_owned());
            roots.insert(join(dir, "src"));
        }
    }
    for (file, &path) in input.paths.iter().enumerate() {
        let file = crate::saturating_u32(file);
        if !production(file) {
            continue;
        }
        let (dir, name) = split_path(path);
        if input.mains[file as usize] {
            if name.ends_with(".go") {
                let (parent, command) = split_path(dir);
                let command = (split_path(parent).1 == "cmd").then(|| command.to_owned());
                add(Node::File(file), EntryReason::GoMain, 5, command);
            } else {
                add(Node::File(file), EntryReason::MainBlock, 3, None);
            }
        }
        match name {
            "__main__.py" => add(Node::File(file), EntryReason::MainModule, 4, None),
            "manage.py" => add(Node::File(file), EntryReason::Framework, 4, None),
            // A Django project's, beside its `manage.py` or one folder
            // below; a library's `wsgi.py` adapts to WSGI and starts nothing
            "wsgi.py" | "asgi.py" => {
                let parent = split_path(dir).0;
                if by_path.contains_key(join(dir, "manage.py").as_str())
                    || by_path.contains_key(join(parent, "manage.py").as_str())
                {
                    add(Node::File(file), EntryReason::Framework, 4, None);
                }
            }
            _ => {}
        }
        let stem = name.split('.').next().unwrap_or(name);
        if CONVENTIONAL.contains(&stem) && roots.contains(dir) {
            add(Node::File(file), EntryReason::ConventionalName, 2, None);
        }
    }

    // The graph: units no production file imports, that depend on the most.
    // What a barrel re-exports is what the facade offers: being re-exported
    // does not count as being imported
    let units = input.units;
    let is_barrel = |unit: usize| match units.nodes[unit] {
        Node::File(file) => input.barrels[file as usize],
        Node::Dir(_) => false,
    };
    let mut imported = vec![false; units.len()];
    for unit in 0..crate::saturating_u32(units.len()) {
        if is_barrel(unit as usize) {
            continue;
        }
        for &to in units.imports(unit) {
            imported[to as usize] = true;
        }
    }
    let dependencies = |unit: usize| input.reach.map_or(0, |reach| reach.dependencies[unit]);
    // A Go program is its file with `func main`, not its package
    let mut programs: HashMap<u32, u32> = HashMap::new();
    for (file, unit) in units.of_file.iter().enumerate() {
        if let Some(unit) = unit
            && input.mains[file]
        {
            programs.entry(*unit).or_insert(crate::saturating_u32(file));
        }
    }
    let node_of = |unit: usize| match units.nodes[unit] {
        Node::Dir(dir) => programs
            .get(&crate::saturating_u32(unit))
            .map_or(Node::Dir(dir), |&file| Node::File(file)),
        node => node,
    };
    let path_of = |node: Node| match node {
        Node::File(file) => input.paths[file as usize].to_owned(),
        Node::Dir(dir) => input.dir_paths[dir as usize].to_owned(),
    };
    let mut roots_of_graph: Vec<(u32, String, usize)> = (0..units.len())
        .filter(|&unit| !imported[unit] && !is_barrel(unit) && dependencies(unit) > 0)
        .map(|unit| (dependencies(unit), path_of(node_of(unit)), unit))
        .collect();
    roots_of_graph.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    for (&(_, _, unit), &points) in roots_of_graph.iter().zip(NO_IMPORTER) {
        add(node_of(unit), EntryReason::NoImporter, points, None);
    }

    // The unit of each candidate, for its dependencies
    let unit_of = |node: Node| match node {
        Node::File(file) => units.of_file[file as usize].map(|unit| unit as usize),
        Node::Dir(dir) => units
            .nodes
            .iter()
            .position(|&known| known == Node::Dir(dir)),
    };
    let mut ranked: Vec<(Node, Candidate, u32, String)> = candidates
        .into_iter()
        .map(|(node, candidate)| {
            let depends = unit_of(node).map_or(0, dependencies);
            (node, candidate, depends, path_of(node))
        })
        .collect();
    ranked.sort_by(|a, b| {
        b.1.score
            .cmp(&a.1.score)
            .then_with(|| b.2.cmp(&a.2))
            .then_with(|| a.3.cmp(&b.3))
    });
    let kept = match ranked
        .iter()
        .filter(|entry| entry.1.score >= THRESHOLD)
        .count()
    {
        0 => FALLBACK,
        sure => sure.min(KEPT),
    };

    let mut entries = Entries::default();
    for (node, mut candidate, _, _) in ranked.into_iter().take(kept) {
        let (file, dir) = match node {
            Node::File(file) => (Some(file), None),
            Node::Dir(dir) => (None, Some(dir)),
        };
        // The strongest reason first; equal ones in a fixed order
        candidate
            .reasons
            .sort_by_key(|&(reason, points)| (std::cmp::Reverse(points), reason as u8));
        entries.file.push(file);
        entries.dir.push(dir);
        entries.reasons.push(
            candidate
                .reasons
                .into_iter()
                .map(|(reason, _)| reason)
                .collect(),
        );
        entries.command.push(candidate.command);
    }
    entries
}

/// The files a `package.json` in `dir` names as entry points.
fn package_json(
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
        let stem = rest.rsplit_once('.').map_or(rest, |(stem, _)| stem);
        found(&format!("src/{stem}"))
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

fn join(dir: &str, path: &str) -> String {
    if dir.is_empty() {
        path.to_owned()
    } else {
        format!("{dir}/{path}")
    }
}

/// Scripts of a `pyproject.toml`, as (command, `module:function`):
/// `[project.scripts]` and `[tool.poetry.scripts]`.
fn pyproject_scripts(content: &[u8]) -> Vec<(String, String)> {
    let text = String::from_utf8_lossy(content);
    let mut scripts = Vec::new();
    let mut inside = false;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            inside = matches!(line, "[project.scripts]" | "[tool.poetry.scripts]");
            continue;
        }
        if inside && let Some((command, target)) = line.split_once('=') {
            let unquote = |text: &str| {
                text.trim()
                    .trim_matches(|c| c == '"' || c == '\'')
                    .to_owned()
            };
            scripts.push((unquote(command), unquote(target)));
        }
    }
    scripts
}

/// `console_scripts` of a `setup.cfg`, as (command, `module:function`).
fn setup_cfg_scripts(content: &[u8]) -> Vec<(String, String)> {
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
fn python_scripts(
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
