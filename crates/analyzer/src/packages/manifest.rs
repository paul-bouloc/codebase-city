//! What the manifests of a package say: its name, its scripts and the
//! dependencies it declares. TOML is read line by line, as far as these
//! fields need.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde_json::Value;

/// The fields of a `package.json` the packages read.
#[derive(Debug, Default)]
pub(super) struct Npm {
    pub name: Option<String>,
    /// `dependencies` and `optionalDependencies`: what a program runs with.
    pub runtime: BTreeSet<String>,
    /// `devDependencies`.
    pub dev: BTreeSet<String>,
    /// `peerDependencies`: what a library expects its user to install.
    pub peer: BTreeSet<String>,
    /// Every dependency it declares, peer ones included.
    pub declared: BTreeSet<String>,
    pub scripts: BTreeMap<String, String>,
    /// The `main` field as written (`expo-router/entry`).
    pub main: Option<String>,
    /// Whether it declares a program to install (`bin`).
    pub bin: bool,
}

pub(super) fn npm(content: &[u8]) -> Option<Npm> {
    let manifest: Value = serde_json::from_slice(content).ok()?;
    let keys = |field: &str| -> BTreeSet<String> {
        manifest
            .get(field)
            .and_then(Value::as_object)
            .map(|map| map.keys().cloned().collect())
            .unwrap_or_default()
    };
    let runtime: BTreeSet<String> = keys("dependencies")
        .into_iter()
        .chain(keys("optionalDependencies"))
        .collect();
    let dev = keys("devDependencies");
    let peer = keys("peerDependencies");
    let declared = runtime.iter().chain(&dev).chain(&peer).cloned().collect();
    let text = |field: &str| {
        manifest
            .get(field)
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .map(str::to_owned)
    };
    Some(Npm {
        name: text("name"),
        runtime,
        dev,
        peer,
        declared,
        scripts: manifest
            .get("scripts")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .filter_map(|(name, script)| Some((name.clone(), script.as_str()?.to_owned())))
            .collect(),
        main: text("main"),
        bin: match manifest.get("bin") {
            Some(Value::String(path)) => !path.is_empty(),
            Some(Value::Object(programs)) => !programs.is_empty(),
            _ => false,
        },
    })
}

/// What a `pyproject.toml` declares: `[project]` and `[tool.poetry]`.
pub(super) struct Pyproject {
    pub name: Option<String>,
    pub dependencies: Vec<String>,
    /// Whether it declares a command to install (`[project.scripts]`).
    pub scripts: bool,
}

pub(super) fn pyproject(content: &[u8]) -> Pyproject {
    let text = String::from_utf8_lossy(content);
    let sections = toml_sections(&text);
    let name = ["project", "tool.poetry"].iter().find_map(|section| {
        toml_value(sections.get(*section)?, "name").filter(|name| !name.is_empty())
    });
    let mut dependencies: Vec<String> = sections
        .get("project")
        .map(|project| toml_array(project, "dependencies"))
        .unwrap_or_default()
        .iter()
        .filter_map(|spec| requirement_name(spec))
        .collect();
    if let Some(poetry) = sections.get("tool.poetry.dependencies") {
        dependencies.extend(toml_keys(poetry).into_iter().filter(|key| key != "python"));
    }
    let scripts = ["project.scripts", "tool.poetry.scripts"]
        .iter()
        .any(|section| {
            sections
                .get(*section)
                .is_some_and(|body| !toml_keys(body).is_empty())
        });
    Pyproject {
        name,
        dependencies,
        scripts,
    }
}

/// The packages a `requirements.txt` lists, options and includes left out.
pub(super) fn requirements(content: &[u8]) -> Vec<String> {
    String::from_utf8_lossy(content)
        .lines()
        .map(|line| line.split('#').next().unwrap_or_default().trim())
        .filter(|line| !line.starts_with('-'))
        .filter_map(requirement_name)
        .collect()
}

/// The modules a `go.mod` requires, single or in a block.
pub(super) fn go_requires(content: &[u8]) -> Vec<String> {
    let text = String::from_utf8_lossy(content);
    let mut modules = Vec::new();
    let mut block = false;
    for line in text.lines() {
        let line = line.split("//").next().unwrap_or_default().trim();
        if block {
            if line.starts_with(')') {
                block = false;
            } else if let Some(module) = line.split_whitespace().next() {
                modules.push(module.trim_matches('"').to_owned());
            }
            continue;
        }
        let Some(rest) = line.strip_prefix("require") else {
            continue;
        };
        let rest = rest.trim();
        if rest == "(" {
            block = true;
        } else if line.starts_with("require ")
            && let Some(module) = rest.split_whitespace().next()
        {
            modules.push(module.trim_matches('"').to_owned());
        }
    }
    modules
}

/// The `module` path of a `go.mod`.
pub(super) fn go_module(content: &[u8]) -> Option<String> {
    String::from_utf8_lossy(content).lines().find_map(|line| {
        let path = line.split("//").next()?.trim().strip_prefix("module ")?;
        let path = path.trim().trim_matches(['"', '`']);
        (!path.is_empty()).then(|| path.to_owned())
    })
}

/// The project name at the start of a requirement: `starlette` in
/// `starlette>=0.46`, `uvicorn` in `uvicorn[standard]`.
fn requirement_name(spec: &str) -> Option<String> {
    let spec = spec.trim();
    let end = spec
        .find(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')))
        .unwrap_or(spec.len());
    let name = &spec[..end];
    (!name.is_empty() && name.starts_with(|c: char| c.is_ascii_alphanumeric()))
        .then(|| name.to_owned())
}

/// A Python project name as pip compares them: lower case, runs of `-`,
/// `_` and `.` as one `-` (`Typing_Extensions` is `typing-extensions`).
pub(super) fn python_key(name: &str) -> String {
    let mut key = String::with_capacity(name.len());
    for c in name.chars() {
        if matches!(c, '-' | '_' | '.') {
            if !key.ends_with('-') {
                key.push('-');
            }
        } else {
            key.push(c.to_ascii_lowercase());
        }
    }
    key
}

/// The body of each `[section]` of a TOML file, by name; arrays of tables
/// (`[[x]]`) are left out.
pub(super) fn toml_sections(text: &str) -> HashMap<String, String> {
    let mut sections: HashMap<String, String> = HashMap::new();
    let mut current: Option<String> = Some(String::new());
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("[[") {
            current = None;
            continue;
        }
        if let Some(header) = trimmed.strip_prefix('[') {
            let name = header.split(']').next().unwrap_or_default();
            current = Some(name.chars().filter(|c| !c.is_whitespace()).collect());
            continue;
        }
        if let Some(name) = &current {
            let body = sections.entry(name.clone()).or_default();
            body.push_str(line);
            body.push('\n');
        }
    }
    sections
}

/// The quoted strings of the array `key = [ … ]`, which may span lines.
pub(super) fn toml_array(body: &str, key: &str) -> Vec<String> {
    let Some(start) = value_start(body, key) else {
        return Vec::new();
    };
    let rest = &body[start..];
    if !rest.trim_start().starts_with('[') {
        return Vec::new();
    }
    let mut strings = Vec::new();
    let mut chars = rest.trim_start()[1..].chars();
    while let Some(c) = chars.next() {
        match c {
            ']' => break,
            '#' => {
                // A comment runs to the end of its line
                for c in chars.by_ref() {
                    if c == '\n' {
                        break;
                    }
                }
            }
            '"' | '\'' => {
                let text: String = chars.by_ref().take_while(|&next| next != c).collect();
                strings.push(text);
            }
            _ => {}
        }
    }
    strings
}

/// The quoted string `key = "…"`.
fn toml_value(body: &str, key: &str) -> Option<String> {
    let rest = body[value_start(body, key)?..].trim_start();
    let quote = rest.chars().next().filter(|&c| c == '"' || c == '\'')?;
    let rest = &rest[1..];
    rest.find(quote).map(|end| rest[..end].to_owned())
}

/// The keys of a section, one per `key = …` line.
fn toml_keys(body: &str) -> Vec<String> {
    body.lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.starts_with('#') {
                return None;
            }
            let key = line.split_once('=')?.0.trim();
            let key = key.trim_matches(|c| c == '"' || c == '\'');
            (!key.is_empty() && !key.contains(' ')).then(|| key.to_owned())
        })
        .collect()
}

/// Where the value of `key = …` starts in a section's body, on a line of
/// its own.
fn value_start(body: &str, key: &str) -> Option<usize> {
    let mut offset = 0;
    for line in body.split_inclusive('\n') {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix(key) {
            let rest_trimmed = rest.trim_start();
            if let Some(value) = rest_trimmed.strip_prefix('=') {
                return Some(offset + line.len() - value.len());
            }
        }
        offset += line.len();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_package_json_gives_its_name_scripts_and_dependencies() {
        let npm = npm(br#"{
            "name": "@acme/web", "main": "expo-router/entry",
            "scripts": {"start": "next start", "build": "next build"},
            "dependencies": {"next": "15"}, "optionalDependencies": {"sharp": "1"},
            "devDependencies": {"storybook": "8"}, "peerDependencies": {"react": "19"}
        }"#)
        .unwrap();
        assert_eq!(npm.name.as_deref(), Some("@acme/web"));
        assert_eq!(npm.main.as_deref(), Some("expo-router/entry"));
        assert!(npm.scripts.contains_key("start"));
        assert!(!npm.bin);
        assert!(super::npm(br#"{"bin": {"tool": "cli.js"}}"#).unwrap().bin);
        assert!(super::npm(br#"{"bin": "cli.js"}"#).unwrap().bin);
        assert!(!super::npm(br#"{"bin": {}}"#).unwrap().bin);
        assert_eq!(Vec::from_iter(&npm.runtime), ["next", "sharp"]);
        assert_eq!(Vec::from_iter(&npm.dev), ["storybook"]);
        assert_eq!(npm.declared.len(), 4);
        assert!(super::npm(b"not json").is_none());
    }

    #[test]
    fn a_pyproject_gives_its_name_dependencies_and_commands() {
        let fastapi = pyproject(
            b"[build-system]\nrequires = [\"pdm-backend\"]\n\n[project]\nname = \"fastapi\"\ndependencies = [\n    \"starlette>=0.46.0\", # web\n    'pydantic>=2.9.0',\n    \"typing-extensions>=4.8.0\",\n]\n[project.optional-dependencies]\nall = [\"httpx\"]\n\n[project.scripts]\nfastapi = \"fastapi.cli:main\"\n",
        );
        assert_eq!(fastapi.name.as_deref(), Some("fastapi"));
        assert_eq!(
            fastapi.dependencies,
            ["starlette", "pydantic", "typing-extensions"]
        );
        assert!(fastapi.scripts);
        let app = pyproject(
            b"[tool.poetry]\nname = \"app\"\n\n[tool.poetry.dependencies]\npython = \"^3.11\"\ndjango = \"^5\"\n",
        );
        assert_eq!(app.name.as_deref(), Some("app"));
        assert_eq!(app.dependencies, ["django"]);
        assert!(!app.scripts);
    }

    #[test]
    fn requirements_list_projects_without_options() {
        assert_eq!(
            requirements(
                b"# web\nfastapi>=0.109.0\nuvicorn[standard]==0.27\n-r base.txt\n--index-url x\n\nanthropic>=0.34,<1 # sdk\n"
            ),
            ["fastapi", "uvicorn", "anthropic"]
        );
    }

    #[test]
    fn go_mod_gives_its_module_and_requirements() {
        let go_mod = b"module github.com/gin-gonic/gin\n\ngo 1.22\n\nrequire github.com/a/b v1.0.0\nrequire (\n\tgithub.com/c/d v2.0.0 // indirect\n\tgolang.org/x/net v0.1.0\n)\n";
        assert_eq!(
            go_module(go_mod).as_deref(),
            Some("github.com/gin-gonic/gin")
        );
        assert_eq!(
            go_requires(go_mod),
            ["github.com/a/b", "github.com/c/d", "golang.org/x/net"]
        );
    }

    #[test]
    fn python_names_compare_as_pip_does() {
        assert_eq!(python_key("Typing_Extensions"), "typing-extensions");
        assert_eq!(python_key("zope.interface"), "zope-interface");
        assert_eq!(python_key("a__b"), "a-b");
    }
}
