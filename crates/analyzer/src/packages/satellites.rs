//! The satellites of a root project: its documentation site, its test app,
//! its editor or its benchmarks. They live beside the code without being
//! it, so their source files become documentation or examples.
//!
//! Under a root project of a language no workspace declares, a folder
//! with a manifest of that language and code of it is a satellite (the
//! rule that keeps it from being a package, in `with_implicit`). Go is the
//! exception: its toolchain keeps a nested module out of the one around
//! it. A satellite that is published on its own (a named, public package
//! that does not use the root one) stays code: the plugins of prettier.
//! Under a JavaScript root, a first-level folder with an `index.html` and
//! code is a satellite too, manifest or not: the editor of three.js.

use std::collections::HashMap;

use model::Scope;

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

/// What a satellite candidate turns out to be.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    /// A documentation site: its source files are documentation.
    Site,
    /// A test app, a sandbox, an editor: its source files are examples.
    Example,
    /// A package published on its own: its files stay code.
    Published,
}

struct Candidate {
    ecosystem: Ecosystem,
    kind: Kind,
    /// Whether it holds a source file of its ecosystem.
    code: bool,
}

/// Gives the source files of each satellite of the root project the scope
/// of what it is. `paths`, `languages` and `scopes` are per file;
/// `manifests` are the manifests that kept their content, by path.
pub(crate) fn apply(
    paths: &[&str],
    languages: &[Language],
    scopes: &mut [Scope],
    manifests: &[(&str, &[u8])],
) {
    let content = |path: &str| {
        manifests
            .iter()
            .find(|(each, _)| *each == path)
            .map(|&(_, content)| content)
    };
    let declarations = workspace::declarations(manifests);
    let roots: Vec<Ecosystem> = workspace::undeclared(&declarations)
        .into_iter()
        .filter(|&ecosystem| ecosystem != Ecosystem::Go)
        .filter(|ecosystem| {
            ecosystem
                .manifests()
                .iter()
                .any(|name| content(name).is_some())
        })
        .collect();
    if roots.is_empty() {
        return;
    }
    let root_names: Vec<String> = [
        content("package.json").and_then(|content| manifest::npm(content)?.name),
        content("pyproject.toml").and_then(|content| manifest::pyproject(content).name),
    ]
    .into_iter()
    .flatten()
    .collect();

    let mut candidates: HashMap<&str, Candidate> = HashMap::new();
    for &(path, content) in manifests {
        let (dir, name) = split_path(path);
        if dir.is_empty() {
            continue;
        }
        let Some(&ecosystem) = roots
            .iter()
            .find(|ecosystem| ecosystem.manifests().contains(&name))
        else {
            continue;
        };
        if candidates.contains_key(dir) {
            continue;
        }
        let kind = kind(dir, name, content, &root_names);
        candidates.insert(
            dir,
            Candidate {
                ecosystem,
                kind,
                code: false,
            },
        );
    }
    if roots.contains(&Ecosystem::JavaScript) {
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

    for (file, &path) in paths.iter().enumerate() {
        if scopes[file] != Scope::Source {
            continue;
        }
        for dir in around(path) {
            if let Some(candidate) = candidates.get_mut(dir)
                && candidate.ecosystem.holds(languages[file])
            {
                candidate.code = true;
            }
        }
    }
    for (file, &path) in paths.iter().enumerate() {
        if scopes[file] != Scope::Source {
            continue;
        }
        let satellite =
            around(path).find_map(|dir| candidates.get(dir).filter(|candidate| candidate.code));
        match satellite.map(|candidate| candidate.kind) {
            Some(Kind::Site) => scopes[file] = Scope::Docs,
            Some(Kind::Example) => scopes[file] = Scope::Example,
            Some(Kind::Published) | None => {}
        }
    }
}

/// The folders around the file at `path`, the outermost first.
fn around(path: &str) -> impl Iterator<Item = &str> {
    let dir = split_path(path).0;
    dir.match_indices('/')
        .map(move |(end, _)| &dir[..end])
        .chain((!dir.is_empty()).then_some(dir))
}

/// What the project in `dir`, with the manifest `name`, is.
fn kind(dir: &str, name: &str, content: &[u8], root_names: &[String]) -> Kind {
    let (project, dependencies, private) = if name == "pyproject.toml" {
        let manifest = manifest::pyproject(content);
        (manifest.name, manifest.dependencies, false)
    } else {
        // `deno.json` lists no dependencies the way `package.json` does
        let manifest = manifest::npm(content).unwrap_or_default();
        let private = manifest.private;
        (
            manifest.name,
            manifest.declared.into_iter().collect(),
            private,
        )
    };
    let site = dependencies
        .iter()
        .any(|dependency| SITE_GENERATORS.contains(&dependency.as_str()));
    if site {
        return Kind::Site;
    }
    let uses_root = root_names
        .iter()
        .any(|root| dependencies.contains(root) || project.as_ref() == Some(root));
    match folder_kind(dir) {
        Kind::Site => Kind::Site,
        _ if project.is_some() && !private && !uses_root => Kind::Published,
        kind => kind,
    }
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
    /// `(path, content)`, a manifest when its name says so.
    fn scopes(files: &[(&str, &str)]) -> Vec<(String, Scope)> {
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
                matches!(
                    name,
                    "package.json" | "pyproject.toml" | "go.mod" | "pnpm-workspace.yaml"
                )
            })
            .map(|(path, content)| (*path, content.as_bytes()))
            .collect();
        apply(&paths, &languages, &mut scopes, &manifests);
        paths
            .iter()
            .zip(scopes)
            .filter(|(path, _)| !path.ends_with(".json") && !path.ends_with(".html"))
            .map(|(path, scope)| ((*path).to_owned(), scope))
            .collect()
    }

    fn scope_of(scopes: &[(String, Scope)], path: &str) -> Scope {
        scopes
            .iter()
            .find(|(each, _)| each == path)
            .map(|(_, scope)| *scope)
            .unwrap_or_else(|| panic!("no file {path}"))
    }

    const LIB: (&str, &str) = ("package.json", r#"{ "name": "lib" }"#);
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
    fn a_test_app_that_uses_the_library_is_an_example() {
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
            (
                "bench/package.json",
                r#"{ "name": "lib-bench", "private": true }"#,
            ),
            ("bench/run.js", "console.log(1)\n"),
            // A project without a name, or named as the root
            ("usage/package.json", r#"{ "dependencies": {} }"#),
            ("usage/index.js", "console.log(1)\n"),
            ("demo-app/package.json", r#"{ "name": "lib" }"#),
            ("demo-app/index.js", "console.log(1)\n"),
        ]);
        assert_eq!(scope_of(&scopes, "app/src/main.tsx"), Scope::Example);
        assert_eq!(scope_of(&scopes, "app/src/main.test.tsx"), Scope::Test);
        // `bench` already sets the scope of what it holds
        assert_eq!(scope_of(&scopes, "bench/run.js"), Scope::Bench);
        assert_eq!(scope_of(&scopes, "usage/index.js"), Scope::Example);
        assert_eq!(scope_of(&scopes, "demo-app/index.js"), Scope::Example);
    }

    #[test]
    fn a_package_published_on_its_own_stays_code() {
        let scopes = scopes(&[
            LIB,
            CODE,
            (
                "packages/plugin-a/package.json",
                r#"{ "name": "@lib/plugin-a" }"#,
            ),
            ("packages/plugin-a/index.js", "export default 1\n"),
        ]);
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
    fn nothing_changes_without_a_root_project_of_the_language() {
        let satellite = [
            ("app/package.json", r#"{ "private": true }"#),
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
        // A pyproject.toml that only configures tools, under a Python root
        let scopes = scopes(&[
            ("pyproject.toml", "[project]\nname = \"lib\"\n"),
            ("lib/core.py", "VALUE = 1\n"),
            ("tools/pyproject.toml", "[tool.ruff]\nline-length = 100\n"),
            ("tools/gen.js", "console.log(1)\n"),
        ]);
        assert_eq!(scope_of(&scopes, "tools/gen.js"), Scope::Source);
    }
}
