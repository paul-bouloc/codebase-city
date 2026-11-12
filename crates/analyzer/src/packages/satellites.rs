//! The satellites of a library: its documentation site, its test app, its
//! editor or its benchmarks. They live beside the code without being it,
//! so their source files become documentation or examples.
//!
//! A root project is a project of a language no workspace declares, with a
//! manifest at the root and code of its own (not Go: its toolchain keeps a
//! nested module out of the one around it). Under it, a folder with a
//! manifest of the same language and code of it (the rule that keeps it
//! from being a package, in `with_implicit`) is a satellite when it
//! depends on the root package: a test app, a usage example, a benchmark.
//! When the root is a library, a documentation site is one too, and so is
//! a first-level folder with an `index.html` and code, manifest or not:
//! the editor of three.js. Any other project stays code: the main process
//! of an Electron app keeps a manifest of its own, often named as the root
//! one, and an app's front end (`client/index.html`) is the app. No
//! satellite is imported by the source code outside the satellites.

use std::collections::HashMap;

use model::Scope;
use serde_json::{Map, Value};

use super::manifest;
use super::workspace::{self, Ecosystem};
use crate::files::{Language, split_path};

/// Dependencies that make a project a documentation site.
const SITE_GENERATORS: &[&str] = &[
    "@11ty/eleventy",
    "@docusaurus/core",
    "astro",
    "gatsby",
    "mkdocs",
    "nextra",
    "sphinx",
    "vitepress",
    "vuepress",
];

/// Names of a folder that holds a documentation site.
const SITE_FOLDERS: &[&str] = &["manual", "site", "website", "www"];

/// The fields of a `package.json` that list dependencies.
const NPM_DEPENDENCIES: &[&str] = &[
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
];

/// What a satellite candidate turns out to be.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    /// A documentation site: its source files are documentation.
    Site,
    /// A test app, a benchmark, an editor: its source files are examples.
    Example,
    /// A project of its own: its files stay code.
    Code,
}

struct Candidate {
    ecosystem: Ecosystem,
    kind: Kind,
    /// Whether it holds a source file of its ecosystem.
    code: bool,
}

/// The root project, in each language it has a manifest of.
struct Root {
    /// The name in its `package.json`.
    npm: Option<String>,
    /// The name in its `pyproject.toml`, as pip compares them
    /// ([`manifest::python_key`]).
    python: Option<String>,
    /// Whether its `package.json` publishes a library: not `private`, with
    /// `exports`, `module` or `types`. An app's `main` says nothing.
    library: bool,
}

/// Gives the source files of each satellite of the root project the scope
/// of what it is. `paths`, `languages` and `scopes` are per file;
/// `manifests` are the manifests that kept their content, by path;
/// `imports` are `(importing file, imported folder)` pairs.
pub(crate) fn apply<'a>(
    paths: &[&str],
    languages: &[Language],
    scopes: &mut [Scope],
    manifests: &[(&str, &[u8])],
    imports: impl Iterator<Item = (u32, &'a str)>,
) {
    let content = |path: &str| {
        manifests
            .iter()
            .find(|(each, _)| *each == path)
            .map(|&(_, content)| content)
    };
    let declarations = workspace::declarations(manifests);
    let ecosystems: Vec<Ecosystem> = workspace::undeclared(&declarations)
        .into_iter()
        .filter(|&ecosystem| ecosystem != Ecosystem::Go)
        .filter(|ecosystem| {
            ecosystem
                .manifests()
                .iter()
                .any(|name| content(name).is_some())
        })
        .collect();
    if ecosystems.is_empty() {
        return;
    }
    let root_npm = content("package.json").and_then(|content| serde_json::from_slice(content).ok());
    let root = Root {
        npm: root_npm
            .as_ref()
            .and_then(|manifest: &Value| manifest.get("name")?.as_str())
            .map(str::to_owned),
        python: content("pyproject.toml")
            .and_then(|content| manifest::pyproject(content).name)
            .map(|name| manifest::python_key(&name)),
        library: root_npm.as_ref().is_some_and(|manifest| {
            manifest.get("private").and_then(Value::as_bool) != Some(true)
                && ["exports", "module", "types", "typings"]
                    .iter()
                    .any(|field| manifest.get(*field).is_some())
        }),
    };

    let mut candidates: HashMap<&str, Candidate> = HashMap::new();
    for &(path, content) in manifests {
        let (dir, name) = split_path(path);
        if dir.is_empty() {
            continue;
        }
        let Some(&ecosystem) = ecosystems
            .iter()
            .find(|ecosystem| ecosystem.manifests().contains(&name))
        else {
            continue;
        };
        let kind = kind(dir, ecosystem, content, &root);
        // A folder with manifests of two languages: the one that makes it
        // a satellite
        if candidates
            .get(dir)
            .is_some_and(|candidate| candidate.kind != Kind::Code || kind == Kind::Code)
        {
            continue;
        }
        candidates.insert(
            dir,
            Candidate {
                ecosystem,
                kind,
                code: false,
            },
        );
    }
    if ecosystems.contains(&Ecosystem::JavaScript) && root.library {
        for &path in paths {
            let (dir, name) = split_path(path);
            if name == "index.html" && !dir.is_empty() && !dir.contains('/') {
                candidates.entry(dir).or_insert(Candidate {
                    ecosystem: Ecosystem::JavaScript,
                    kind: folder_kind(dir),
                    code: false,
                });
            }
        }
    }
    if candidates.is_empty() {
        return;
    }

    // The code of each candidate, and the root's own: a root manifest that
    // only configures tools (prettier beside a Go server) makes no root
    let mut root_code: Vec<Ecosystem> = Vec::new();
    for (file, &path) in paths.iter().enumerate() {
        if scopes[file] != Scope::Source {
            continue;
        }
        let mut outside = true;
        for dir in around(path) {
            if let Some(candidate) = candidates.get_mut(dir) {
                outside = false;
                if candidate.ecosystem.holds(languages[file]) {
                    candidate.code = true;
                }
            }
        }
        if outside {
            for &ecosystem in &ecosystems {
                if ecosystem.holds(languages[file]) && !root_code.contains(&ecosystem) {
                    root_code.push(ecosystem);
                }
            }
        }
    }
    candidates.retain(|_, candidate| root_code.contains(&candidate.ecosystem));

    // A folder the source code outside the satellites imports is part of
    // the code. Satellites may import one another (a site shows the test
    // app); one that turns out to be code makes what it imports code too,
    // so repeat until nothing changes
    let imports: Vec<(usize, &str)> = imports
        .map(|(from, to)| (from as usize, to))
        .filter(|&(from, _)| scopes[from] == Scope::Source)
        .collect();
    loop {
        let mut changed = false;
        for &(from, to) in &imports {
            let from_dir = split_path(paths[from]).0;
            let in_satellite = ancestors(from_dir).any(|dir| {
                candidates
                    .get(dir)
                    .is_some_and(|candidate| candidate.code && candidate.kind != Kind::Code)
            });
            if in_satellite {
                continue;
            }
            for dir in ancestors(to) {
                if !within(from_dir, dir)
                    && let Some(candidate) = candidates.get_mut(dir)
                    && candidate.kind != Kind::Code
                {
                    candidate.kind = Kind::Code;
                    changed = true;
                }
            }
        }
        if !changed {
            break;
        }
    }

    for (file, &path) in paths.iter().enumerate() {
        if scopes[file] != Scope::Source {
            continue;
        }
        // The outermost candidate with code decides, a project of its own
        // included
        let satellite =
            around(path).find_map(|dir| candidates.get(dir).filter(|candidate| candidate.code));
        match satellite.map(|candidate| candidate.kind) {
            Some(Kind::Site) => scopes[file] = Scope::Docs,
            Some(Kind::Example) => scopes[file] = Scope::Example,
            Some(Kind::Code) | None => {}
        }
    }
}

/// The folder `dir` and the folders around it, the outermost first; none
/// for the root.
fn ancestors(dir: &str) -> impl Iterator<Item = &str> {
    dir.match_indices('/')
        .map(move |(end, _)| &dir[..end])
        .chain((!dir.is_empty()).then_some(dir))
}

/// The folders around the file at `path`, the outermost first.
fn around(path: &str) -> impl Iterator<Item = &str> {
    ancestors(split_path(path).0)
}

/// Whether the folder `dir` is `ancestor` or lies in it.
fn within(dir: &str, ancestor: &str) -> bool {
    dir.strip_prefix(ancestor)
        .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
}

/// What the project in `dir`, with a manifest of `ecosystem`, is.
fn kind(dir: &str, ecosystem: Ecosystem, content: &[u8], root: &Root) -> Kind {
    let (site, uses_root, library) = if ecosystem == Ecosystem::Python {
        let dependencies: Vec<String> = manifest::pyproject(content)
            .dependencies
            .iter()
            .map(|dependency| manifest::python_key(dependency))
            .collect();
        let site = dependencies
            .iter()
            .any(|dependency| SITE_GENERATORS.contains(&dependency.as_str()));
        let uses_root = root
            .python
            .as_ref()
            .is_some_and(|root| dependencies.contains(root));
        // A named Python project may be imported: nothing tells an app
        (site, uses_root, root.python.is_some())
    } else {
        // `deno.json` lists no dependencies the way `package.json` does
        let manifest: Value = serde_json::from_slice(content).unwrap_or_default();
        let empty = Map::new();
        let dependencies = || {
            NPM_DEPENDENCIES.iter().flat_map(|field| {
                manifest
                    .get(*field)
                    .and_then(Value::as_object)
                    .unwrap_or(&empty)
            })
        };
        let site = dependencies().any(|(name, _)| SITE_GENERATORS.contains(&name.as_str()));
        let uses_root = root
            .npm
            .as_ref()
            .is_some_and(|root| npm_uses(dir, dependencies(), root));
        (site, uses_root, root.library)
    };
    if (site || folder_kind(dir) == Kind::Site) && (library || uses_root) {
        Kind::Site
    } else if uses_root {
        Kind::Example
    } else {
        Kind::Code
    }
}

/// Whether the dependencies of the `package.json` in `dir` name the root
/// package `root`: by its name, by an alias of a version of it
/// (`"immer10": "npm:immer@10"`), or by its folder (`"file:.."`).
fn npm_uses<'a>(
    dir: &str,
    mut dependencies: impl Iterator<Item = (&'a String, &'a Value)>,
    root: &str,
) -> bool {
    let up = vec![".."; dir.split('/').count()].join("/");
    let alias = format!("npm:{root}");
    dependencies.any(|(name, spec)| {
        let spec = spec.as_str().unwrap_or_default();
        let path = spec
            .strip_prefix("file:")
            .or_else(|| spec.strip_prefix("link:"))
            .map(|path| path.trim_end_matches('/'));
        name == root
            || spec
                .strip_prefix(&alias)
                .is_some_and(|rest| rest.is_empty() || rest.starts_with('@'))
            || path == Some(up.as_str())
    })
}

/// What a satellite is from the name of its folder alone.
fn folder_kind(dir: &str) -> Kind {
    let last = dir.rsplit('/').next().unwrap_or(dir).to_ascii_lowercase();
    if SITE_FOLDERS.contains(&last.as_str()) {
        Kind::Site
    } else {
        Kind::Example
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The scopes of `files` once the satellites are applied: each file is
    /// `(path, content)`, a manifest when its name says so; `imports` are
    /// `(importing file, imported folder)` by path.
    fn scopes_with(files: &[(&str, &str)], imports: &[(&str, &str)]) -> Vec<(String, Scope)> {
        let paths: Vec<&str> = files.iter().map(|(path, _)| *path).collect();
        let languages: Vec<Language> = paths.iter().map(|path| Language::of(path)).collect();
        let mut scopes: Vec<Scope> = paths
            .iter()
            .map(|path| crate::files::scope::of(path))
            .collect();
        let manifests: Vec<(&str, &[u8])> = files
            .iter()
            .filter(|(path, _)| {
                let name = split_path(path).1;
                matches!(name, "package.json" | "pyproject.toml" | "go.mod")
            })
            .map(|(path, content)| (*path, content.as_bytes()))
            .collect();
        let imports: Vec<(u32, &str)> = imports
            .iter()
            .map(|&(from, to)| {
                let from = paths.iter().position(|path| *path == from).unwrap();
                (u32::try_from(from).unwrap(), to)
            })
            .collect();
        apply(
            &paths,
            &languages,
            &mut scopes,
            &manifests,
            imports.into_iter(),
        );
        paths
            .iter()
            .zip(scopes)
            .map(|(path, scope)| ((*path).to_owned(), scope))
            .collect()
    }

    fn scopes(files: &[(&str, &str)]) -> Vec<(String, Scope)> {
        scopes_with(files, &[])
    }

    fn scope_of(scopes: &[(String, Scope)], path: &str) -> Scope {
        scopes
            .iter()
            .find(|(each, _)| each == path)
            .map(|(_, scope)| *scope)
            .unwrap_or_else(|| panic!("no file {path}"))
    }

    const LIB: (&str, &str) = (
        "package.json",
        r#"{ "name": "lib", "exports": "./src/index.ts" }"#,
    );
    const CODE: (&str, &str) = ("src/index.ts", "export const lib = 1\n");

    #[test]
    fn a_documentation_site_is_documentation() {
        let scopes = scopes(&[
            LIB,
            CODE,
            (
                "website/package.json",
                r#"{ "name": "website", "dependencies": { "@docusaurus/core": "3" } }"#,
            ),
            ("website/src/pages/index.tsx", "export default 1\n"),
            ("website/sidebars.js", "module.exports = {}\n"),
        ]);
        assert_eq!(scope_of(&scopes, "src/index.ts"), Scope::Source);
        assert_eq!(
            scope_of(&scopes, "website/src/pages/index.tsx"),
            Scope::Docs
        );
        assert_eq!(scope_of(&scopes, "website/sidebars.js"), Scope::Docs);
    }

    #[test]
    fn a_site_is_known_by_its_folder_too() {
        let scopes = scopes(&[
            LIB,
            CODE,
            ("site/package.json", r#"{ "private": true }"#),
            ("site/main.js", "console.log(1)\n"),
        ]);
        assert_eq!(scope_of(&scopes, "site/main.js"), Scope::Docs);
    }

    #[test]
    fn a_project_that_depends_on_the_root_package_is_an_example() {
        let scopes = scopes(&[
            LIB,
            CODE,
            (
                "app/package.json",
                r#"{ "name": "lib-app", "dependencies": { "lib": "*", "react": "19" } }"#,
            ),
            ("app/src/main.tsx", "export default 1\n"),
            // Its tests stay tests
            ("app/src/main.test.tsx", "test('a', () => {})\n"),
            // Versions of the root under aliases, or the root folder
            (
                "perf/package.json",
                r#"{ "private": true, "dependencies": { "lib9": "npm:lib@9" } }"#,
            ),
            ("perf/run.js", "console.log(1)\n"),
            (
                "usage/esm/package.json",
                r#"{ "dependencies": { "my-lib": "file:../.." } }"#,
            ),
            ("usage/esm/index.js", "console.log(1)\n"),
        ]);
        assert_eq!(scope_of(&scopes, "app/src/main.tsx"), Scope::Example);
        assert_eq!(scope_of(&scopes, "app/src/main.test.tsx"), Scope::Test);
        assert_eq!(scope_of(&scopes, "perf/run.js"), Scope::Example);
        assert_eq!(scope_of(&scopes, "usage/esm/index.js"), Scope::Example);
    }

    #[test]
    fn a_project_that_does_not_use_the_root_stays_code() {
        let scopes = scopes(&[
            // The main process of an Electron app, named as the root
            (
                "package.json",
                r#"{ "name": "term", "dependencies": { "react": "19" } }"#,
            ),
            ("lib/index.ts", "export const ui = 1\n"),
            (
                "app/package.json",
                r#"{ "name": "term", "dependencies": { "chokidar": "4" } }"#,
            ),
            ("app/index.ts", "export const main = 1\n"),
            // A private server, a published plugin
            ("server/package.json", r#"{ "private": true }"#),
            ("server/main.js", "console.log(1)\n"),
            (
                "packages/plugin-a/package.json",
                r#"{ "name": "@term/plugin-a" }"#,
            ),
            ("packages/plugin-a/index.js", "export default 1\n"),
        ]);
        assert_eq!(scope_of(&scopes, "app/index.ts"), Scope::Source);
        assert_eq!(scope_of(&scopes, "server/main.js"), Scope::Source);
        assert_eq!(
            scope_of(&scopes, "packages/plugin-a/index.js"),
            Scope::Source
        );
    }

    #[test]
    fn a_first_level_folder_with_a_page_is_an_example() {
        let scopes = scopes(&[
            LIB,
            CODE,
            ("editor/index.html", "<html></html>\n"),
            ("editor/js/editor.js", "export const editor = 1\n"),
            ("manual/index.html", "<html></html>\n"),
            ("manual/resources/lesson.js", "export const lesson = 1\n"),
            // Deeper, a page is part of the code
            ("src/inspector/index.html", "<html></html>\n"),
            ("src/inspector/panel.js", "export const panel = 1\n"),
        ]);
        assert_eq!(scope_of(&scopes, "editor/js/editor.js"), Scope::Example);
        assert_eq!(scope_of(&scopes, "manual/resources/lesson.js"), Scope::Docs);
        assert_eq!(scope_of(&scopes, "src/inspector/panel.js"), Scope::Source);
    }

    #[test]
    fn a_folder_the_code_outside_imports_is_code() {
        // A page and code in `src`, which the code at the root imports
        let files = [
            LIB,
            ("src/index.html", "<html></html>\n"),
            ("src/main.js", "export const app = 1\n"),
            ("server.js", "console.log(1)\n"),
            ("lab/index.html", "<html></html>\n"),
            ("lab/main.js", "console.log(1)\n"),
            // A test that imports the lab does not make it code
            ("test/lab.test.js", "test('a', () => {})\n"),
        ];
        let scopes = scopes_with(&files, &[("server.js", "src"), ("test/lab.test.js", "lab")]);
        assert_eq!(scope_of(&scopes, "src/main.js"), Scope::Source);
        assert_eq!(scope_of(&scopes, "lab/main.js"), Scope::Example);
    }

    #[test]
    fn a_satellite_may_import_another_one() {
        let files = [
            LIB,
            CODE,
            ("website/package.json", r#"{ "private": true }"#),
            ("website/main.js", "console.log(1)\n"),
            ("studio/index.html", "<html></html>\n"),
            ("studio/main.js", "console.log(1)\n"),
            ("live/index.html", "<html></html>\n"),
            ("live/main.js", "console.log(1)\n"),
        ];
        let scopes = scopes_with(&files, &[("website/main.js", "live")]);
        assert_eq!(scope_of(&scopes, "live/main.js"), Scope::Example);
    }

    #[test]
    fn the_outermost_satellite_decides() {
        let scopes = scopes(&[
            LIB,
            CODE,
            (
                "website/package.json",
                r#"{ "dependencies": { "@docusaurus/core": "3" } }"#,
            ),
            (
                "website/plugins/a/package.json",
                r#"{ "name": "plugin-a" }"#,
            ),
            ("website/plugins/a/index.js", "export default 1\n"),
        ]);
        assert_eq!(scope_of(&scopes, "website/plugins/a/index.js"), Scope::Docs);
    }

    #[test]
    fn a_python_project_that_depends_on_the_root_is_an_example() {
        let scopes = scopes(&[
            ("pyproject.toml", "[project]\nname = \"My_Lib\"\n"),
            ("my_lib/core.py", "VALUE = 1\n"),
            (
                "demo_app/pyproject.toml",
                "[project]\nname = \"demo\"\ndependencies = [\"my.lib\"]\n",
            ),
            ("demo_app/main.py", "print(1)\n"),
            ("worker/pyproject.toml", "[project]\nname = \"worker\"\n"),
            ("worker/run.py", "print(1)\n"),
        ]);
        assert_eq!(scope_of(&scopes, "demo_app/main.py"), Scope::Example);
        assert_eq!(scope_of(&scopes, "worker/run.py"), Scope::Source);
    }

    #[test]
    fn nothing_changes_without_a_root_project_of_the_language() {
        let satellite = [
            ("app/package.json", r#"{ "dependencies": { "repo": "*" } }"#),
            ("app/main.js", "console.log(1)\n"),
        ];
        // A declared workspace: `app` would be a package if it matched
        let declared = scopes(&[
            (
                "package.json",
                r#"{ "name": "repo", "private": true, "workspaces": ["libs/*"] }"#,
            ),
            satellite[0],
            satellite[1],
        ]);
        assert_eq!(scope_of(&declared, "app/main.js"), Scope::Source);
        // No root manifest of the language: a Go server and its front
        let go = scopes(&[
            ("go.mod", "module example.com/server\n\ngo 1.22\n"),
            ("main.go", "package main\n\nfunc main() {}\n"),
            satellite[0],
            satellite[1],
        ]);
        assert_eq!(scope_of(&go, "app/main.js"), Scope::Source);
        // A nested Go module under a Go root
        let module = scopes(&[
            ("go.mod", "module example.com/server\n\ngo 1.22\n"),
            ("main.go", "package main\n\nfunc main() {}\n"),
            ("api/go.mod", "module example.com/server/api\n\ngo 1.22\n"),
            ("api/client.go", "package api\n"),
        ]);
        assert_eq!(scope_of(&module, "api/client.go"), Scope::Source);
    }

    #[test]
    fn a_project_without_code_of_its_language_is_no_satellite() {
        // A site folder of JavaScript under a Python root
        let scopes = scopes(&[
            ("pyproject.toml", "[project]\nname = \"lib\"\n"),
            ("lib/core.py", "VALUE = 1\n"),
            ("website/pyproject.toml", "[tool.ruff]\nline-length = 100\n"),
            ("website/main.js", "console.log(1)\n"),
        ]);
        assert_eq!(scope_of(&scopes, "website/main.js"), Scope::Source);
    }

    #[test]
    fn an_app_keeps_its_front_end_and_its_site() {
        // An app publishes no library: its pages and its site are its own
        let scopes = scopes(&[
            (
                "package.json",
                r#"{ "name": "app", "private": true, "dependencies": { "express": "5" } }"#,
            ),
            ("server/index.js", "console.log(1)\n"),
            ("client/index.html", "<html></html>\n"),
            ("client/src/main.jsx", "export default 1\n"),
            (
                "web/package.json",
                r#"{ "name": "web", "dependencies": { "astro": "5" } }"#,
            ),
            ("web/src/page.ts", "export const page = 1\n"),
        ]);
        assert_eq!(scope_of(&scopes, "client/src/main.jsx"), Scope::Source);
        assert_eq!(scope_of(&scopes, "web/src/page.ts"), Scope::Source);
    }

    #[test]
    fn a_root_manifest_without_code_makes_no_root_project() {
        // A Go server with a package.json for its formatter
        let scopes = scopes(&[
            ("go.mod", "module example.com/server\n\ngo 1.22\n"),
            ("main.go", "package main\n\nfunc main() {}\n"),
            (
                "package.json",
                r#"{ "name": "server", "types": "x.d.ts", "devDependencies": { "prettier": "3" } }"#,
            ),
            ("frontend/index.html", "<html></html>\n"),
            ("frontend/src/main.ts", "export const app = 1\n"),
        ]);
        assert_eq!(scope_of(&scopes, "frontend/src/main.ts"), Scope::Source);
    }

    #[test]
    fn what_a_satellite_turned_code_imports_is_code_too() {
        // `src` imports `studio`, which imports `lab`: in any order
        let files = [
            LIB,
            CODE,
            ("lab/package.json", r#"{ "dependencies": { "lib": "*" } }"#),
            ("lab/util.js", "export const util = 1\n"),
            ("studio/index.html", "<html></html>\n"),
            ("studio/lib.js", "export const lib = 1\n"),
        ];
        let scopes = scopes_with(
            &files,
            &[("studio/lib.js", "lab"), ("src/index.ts", "studio")],
        );
        assert_eq!(scope_of(&scopes, "studio/lib.js"), Scope::Source);
        assert_eq!(scope_of(&scopes, "lab/util.js"), Scope::Source);
    }

    #[test]
    fn a_folder_with_two_manifests_is_judged_by_both() {
        // A JavaScript formatter at the root of a Python library; the demo
        // has a tooling package.json beside the project that uses the library
        let scopes = scopes(&[
            ("package.json", r#"{ "private": true }"#),
            ("pyproject.toml", "[project]\nname = \"mylib\"\n"),
            ("mylib/core.py", "VALUE = 1\n"),
            ("demo_app/package.json", r#"{ "private": true }"#),
            (
                "demo_app/pyproject.toml",
                "[project]\nname = \"demo\"\ndependencies = [\"mylib\"]\n",
            ),
            ("demo_app/app.py", "print(1)\n"),
        ]);
        assert_eq!(scope_of(&scopes, "demo_app/app.py"), Scope::Example);
    }
}
