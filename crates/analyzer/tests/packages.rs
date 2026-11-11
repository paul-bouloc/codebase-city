//! The packages of a small monorepo held in memory: what the workspace
//! declares, apps and libraries, frameworks, groups by name, and the
//! dependencies the production code imports.

#![allow(clippy::unwrap_used)]

use analyzer::analyze;
use analyzer::files::{Language, SourceFile, count_lines};
use model::{AnalysisResult, Framework, Ignored, PackageKind, Repo, WorkspaceKind};

/// `apps/acme` (Next.js) and `apps/acme-admin` (NestJS) share
/// `libs/acme-ui`; `apps/site` and `apps/site-blog` share a prefix but no
/// import; `libs/empty` holds no code; `sample/demo` has a manifest but is
/// not declared.
const FILES: &[(&str, &str)] = &[
    (
        "package.json",
        r#"{ "name": "monorepo", "private": true, "workspaces": ["apps/*", "libs/*"],
             "dependencies": { "react": "19" } }"#,
    ),
    (
        "apps/acme/package.json",
        r#"{ "name": "acme", "scripts": { "start": "next start" },
             "dependencies": { "next": "15", "@acme/ui": "*", "zod": "3" } }"#,
    ),
    (
        "apps/acme/pages/_app.tsx",
        "export default function App() {}\n",
    ),
    (
        "apps/acme/pages/index.tsx",
        "import { Button } from '@acme/ui'\nimport React from 'react'\nimport z from 'zod'\nimport fs from 'node:fs'\nexport default function Home() {}\n",
    ),
    (
        "apps/acme/pages/api/users.ts",
        "import z from 'zod'\nimport Link from 'next/link'\nexport default function handler() {}\n",
    ),
    (
        "apps/acme-admin/package.json",
        r#"{ "name": "acme-admin", "dependencies": { "@nestjs/core": "11", "@acme/ui": "*" } }"#,
    ),
    (
        "apps/acme-admin/nest-cli.json",
        r#"{ "sourceRoot": "src" }"#,
    ),
    (
        "apps/acme-admin/src/main.ts",
        "import { NestFactory } from '@nestjs/core'\nimport { Button } from '@acme/ui'\nexport async function bootstrap() {}\n",
    ),
    (
        "libs/acme-ui/package.json",
        r#"{ "name": "@acme/ui", "main": "dist/index.js", "peerDependencies": { "react": "19" } }"#,
    ),
    (
        "libs/acme-ui/src/index.ts",
        "export { Button } from './button'\n",
    ),
    (
        "libs/acme-ui/src/button.ts",
        "import React from 'react'\nexport function Button() {}\n",
    ),
    (
        "apps/site/package.json",
        r#"{ "name": "site", "scripts": { "start": "node server.js" } }"#,
    ),
    ("apps/site/server.js", "console.log('site')\n"),
    (
        "apps/site-blog/package.json",
        r#"{ "name": "site-blog", "scripts": { "start": "node index.js" } }"#,
    ),
    ("apps/site-blog/index.js", "console.log('blog')\n"),
    ("libs/empty/README.md", "Nothing yet.\n"),
    (
        "sample/demo/package.json",
        r#"{ "name": "demo", "scripts": { "start": "node main.js" } }"#,
    ),
    ("sample/demo/main.js", "console.log('demo')\n"),
];

fn analyzed(files: &[(&str, &str)]) -> AnalysisResult {
    let files = files
        .iter()
        .map(|&(path, content)| SourceFile {
            path: path.to_owned(),
            language: Language::of(path),
            lines: count_lines(content.as_bytes()),
            generated: false,
            content: Some(content.as_bytes().to_vec()),
        })
        .collect();
    let repo = Repo {
        owner: "acme".to_owned(),
        name: "monorepo".to_owned(),
    };
    let result = analyze(repo, "0".repeat(40), files, Ignored::default());
    assert_eq!(result.validate(), Ok(()));
    result
}

fn dir_path(result: &AnalysisResult, dir: u32) -> String {
    let mut parts = Vec::new();
    let mut current = Some(dir);
    while let Some(row) = current {
        if row != 0 {
            parts.push(result.dirs.name[row as usize].as_str());
        }
        current = result.dirs.parent[row as usize];
    }
    parts.reverse();
    parts.join("/")
}

fn file_path(result: &AnalysisResult, file: u32) -> String {
    format!(
        "{}/{}",
        dir_path(result, result.files.dir[file as usize]),
        result.files.name[file as usize]
    )
}

fn row(result: &AnalysisResult, dir: &str) -> usize {
    result
        .packages
        .dir
        .iter()
        .position(|&known| dir_path(result, known) == dir)
        .unwrap()
}

#[test]
fn the_workspace_declares_the_packages_that_hold_code() {
    let result = analyzed(FILES);
    let [workspace] = result.workspaces.as_slice() else {
        panic!("one declaration expected")
    };
    assert_eq!(workspace.kind, WorkspaceKind::Npm);
    assert_eq!(file_path(&result, workspace.manifest), "/package.json");
    let dirs: Vec<String> = result
        .packages
        .dir
        .iter()
        .map(|&dir| dir_path(&result, dir))
        .collect();
    // No `libs/empty` (no code), no `sample/demo` (not declared)
    assert_eq!(
        dirs,
        [
            "apps/acme-admin",
            "apps/acme",
            "apps/site-blog",
            "apps/site",
            "libs/acme-ui"
        ]
    );
    assert_eq!(
        result.packages.name[row(&result, "libs/acme-ui")],
        "@acme/ui"
    );
}

#[test]
fn apps_and_libraries_by_what_they_run() {
    let result = analyzed(FILES);
    let packages = &result.packages;
    let acme = row(&result, "apps/acme");
    assert_eq!(packages.kind[acme], PackageKind::App);
    assert_eq!(packages.framework[acme], Some(Framework::Nextjs));
    assert_eq!(
        dir_path(&result, packages.routes[acme].unwrap()),
        "apps/acme/pages"
    );
    assert_eq!(
        (packages.route_count[acme], packages.api_route_count[acme]),
        (2, 1)
    );
    assert_eq!(
        file_path(&result, packages.entry[acme].unwrap()),
        "apps/acme/pages/_app.tsx"
    );

    let admin = row(&result, "apps/acme-admin");
    assert_eq!(packages.kind[admin], PackageKind::App);
    assert_eq!(packages.framework[admin], Some(Framework::Nestjs));
    assert_eq!(
        file_path(&result, packages.entry[admin].unwrap()),
        "apps/acme-admin/src/main.ts"
    );

    let ui = row(&result, "libs/acme-ui");
    assert_eq!(packages.kind[ui], PackageKind::Library);
    assert_eq!(packages.framework[ui], None);
    assert_eq!(packages.code_files[ui], 2);
    assert_eq!(
        file_path(&result, packages.entry[ui].unwrap()),
        "libs/acme-ui/src/index.ts"
    );
}

#[test]
fn a_prefix_groups_packages_that_import_one_another_or_three_of_them() {
    let result = analyzed(FILES);
    assert_eq!(result.package_groups.prefix, ["acme"]);
    assert_eq!(result.package_groups.linked, [true]);
    let grouped: Vec<String> = (0..result.packages.dir.len())
        .filter(|&row| result.packages.group[row] == Some(0))
        .map(|row| dir_path(&result, result.packages.dir[row]))
        .collect();
    assert_eq!(grouped, ["apps/acme-admin", "apps/acme", "libs/acme-ui"]);
    // `site` and `site-blog`: two names, no import
    assert_eq!(result.packages.group[row(&result, "apps/site")], None);
}

#[test]
fn declared_dependencies_are_counted_by_package() {
    let result = analyzed(FILES);
    let externals = &result.externals;
    let of = |dir: &str| -> Vec<(String, u32)> {
        let package = row(&result, dir);
        (0..externals.name.len())
            .filter(|&at| externals.package[at] == Some(package as u32))
            .map(|at| (externals.name[at].clone(), externals.files[at]))
            .collect()
    };
    // `react` is declared at the root; `node:fs` is built in; `@acme/ui`
    // resolves to the library, so it is not external
    assert_eq!(
        of("apps/acme"),
        [
            ("next".to_owned(), 1),
            ("react".to_owned(), 1),
            ("zod".to_owned(), 2)
        ]
    );
    assert_eq!(of("apps/acme-admin"), [("@nestjs/core".to_owned(), 1)]);
    assert_eq!(of("libs/acme-ui"), [("react".to_owned(), 1)]);
}

#[test]
fn a_repository_without_workspaces_has_no_packages_but_externals() {
    let result = analyzed(&[
        (
            "pyproject.toml",
            "[project]\nname = \"harbor\"\ndependencies = [\"starlette>=0.4\", \"pydantic\"]\n",
        ),
        (
            "harbor/app.py",
            "import os\nfrom starlette.routing import Route\nimport pydantic\n",
        ),
        ("harbor/models.py", "from pydantic import BaseModel\n"),
    ]);
    assert!(result.workspaces.is_empty());
    assert!(result.packages.dir.is_empty());
    assert_eq!(result.externals.name, ["pydantic", "starlette"]);
    assert_eq!(result.externals.files, [2, 1]);
    assert_eq!(result.externals.package, [None, None]);
}

fn island_paths(result: &AnalysisResult) -> Vec<String> {
    result
        .islands
        .dir
        .iter()
        .map(|&dir| dir_path(result, dir))
        .collect()
}

#[test]
fn each_package_of_a_monorepo_is_an_island() {
    let result = analyzed(FILES);
    // No `apps` or `libs` island: they are split into their packages; the
    // root keeps its manifest
    assert_eq!(
        island_paths(&result),
        [
            "",
            "apps/acme-admin",
            "apps/acme",
            "apps/site-blog",
            "apps/site",
            "libs/acme-ui",
            "libs/empty",
            "sample",
        ]
    );
    // The island of a package is the one named after its folder
    for &dir in &result.packages.dir {
        assert!(result.islands.dir.contains(&dir));
    }
}

#[test]
fn a_workspace_with_a_single_package_of_code_keeps_its_islands() {
    // `tools/lint` holds no production code: not a monorepo, and `apps`,
    // with less than half of the code, stays whole
    let result = analyzed(&[
        (
            "package.json",
            r#"{ "name": "root", "workspaces": ["apps/*", "tools/*"] }"#,
        ),
        (
            "apps/web/package.json",
            r#"{ "name": "web", "scripts": { "start": "node main.js" } }"#,
        ),
        ("apps/web/main.js", "console.log('web')\n"),
        ("tools/lint/package.json", r#"{ "name": "lint" }"#),
        ("tools/lint/index.test.js", "console.log('lint')\n"),
        ("src/a.js", "console.log('a')\n"),
        ("src/b.js", "console.log('b')\n"),
    ]);
    assert_eq!(result.packages.dir.len(), 2);
    assert_eq!(island_paths(&result), ["", "apps", "src", "tools"]);
}

#[test]
fn two_packages_of_code_make_a_monorepo_even_when_one_holds_most_of_it() {
    // `apps/web` holds 3 of 4 production files: alone, the old rule would
    // split it into `src` and `lib`
    let result = analyzed(&[
        (
            "package.json",
            r#"{ "name": "root", "workspaces": ["apps/*", "libs/*"] }"#,
        ),
        (
            "apps/web/package.json",
            r#"{ "name": "web", "scripts": { "start": "node src/main.js" } }"#,
        ),
        ("apps/web/src/main.js", "console.log('web')\n"),
        ("apps/web/src/page.js", "console.log('page')\n"),
        ("apps/web/lib/util.js", "console.log('util')\n"),
        ("libs/log/package.json", r#"{ "name": "log" }"#),
        ("libs/log/index.js", "console.log('log')\n"),
    ]);
    assert_eq!(island_paths(&result), ["", "apps/web", "libs/log"]);
}

fn package_paths(result: &AnalysisResult) -> Vec<String> {
    result
        .packages
        .dir
        .iter()
        .map(|&dir| dir_path(result, dir))
        .collect()
}

#[test]
fn a_member_without_a_manifest_is_no_package() {
    // pnpm declares every plugin folder, but only one has a package.json
    let result = analyzed(&[
        ("pnpm-workspace.yaml", "packages:\n  - 'plugins/*'\n"),
        ("plugins/graph/package.json", r#"{ "name": "graph" }"#),
        ("plugins/graph/index.ts", "export const graph = 1\n"),
        ("plugins/text/index.ts", "export const text = 1\n"),
    ]);
    assert_eq!(package_paths(&result), ["plugins/graph"]);
}

#[test]
fn javascript_and_python_declarations_are_read_together() {
    let result = analyzed(&[
        ("package.json", r#"{ "workspaces": ["frontend"] }"#),
        (
            "pyproject.toml",
            "[tool.uv.workspace]\nmembers = [\"backend\"]\n",
        ),
        (
            "frontend/package.json",
            r#"{ "name": "frontend", "scripts": { "dev": "vite", "build": "vite build" } }"#,
        ),
        ("frontend/src/main.ts", "export const app = 1\n"),
        (
            "backend/pyproject.toml",
            "[project]\nname = \"app\"\ndependencies = [\"fastapi>=0.110\"]\n",
        ),
        (
            "backend/app/main.py",
            "from fastapi import FastAPI\napp = FastAPI()\n",
        ),
    ]);
    let kinds: Vec<WorkspaceKind> = result
        .workspaces
        .iter()
        .map(|workspace| workspace.kind)
        .collect();
    assert_eq!(kinds, [WorkspaceKind::Npm, WorkspaceKind::Uv]);
    assert_eq!(package_paths(&result), ["backend", "frontend"]);
    let backend = row(&result, "backend");
    assert_eq!(result.packages.framework[backend], Some(Framework::Fastapi));
    // A Vite app and a FastAPI service no package imports
    assert!(
        result
            .packages
            .kind
            .iter()
            .all(|&kind| kind == PackageKind::App)
    );
}

#[test]
fn nx_projects_say_whether_they_are_applications() {
    let result = analyzed(&[
        (
            "package.json",
            r#"{ "name": "acme", "workspaces": ["packages/*"] }"#,
        ),
        ("nx.json", "{}"),
        ("packages/front/package.json", r#"{ "name": "front" }"#),
        (
            "packages/front/project.json",
            r#"{ "projectType": "application" }"#,
        ),
        (
            "packages/front/src/main.ts",
            "import { ui } from 'ui'\nexport const front = ui\n",
        ),
        (
            "packages/ui/package.json",
            r#"{ "name": "ui", "main": "src/index.ts" }"#,
        ),
        (
            "packages/ui/project.json",
            r#"{ "projectType": "library" }"#,
        ),
        ("packages/ui/src/index.ts", "export const ui = 1\n"),
    ]);
    let kinds: Vec<WorkspaceKind> = result
        .workspaces
        .iter()
        .map(|workspace| workspace.kind)
        .collect();
    assert_eq!(kinds, [WorkspaceKind::Npm, WorkspaceKind::Nx]);
    assert_eq!(
        result.packages.kind[row(&result, "packages/front")],
        PackageKind::App
    );
    assert_eq!(
        result.packages.kind[row(&result, "packages/ui")],
        PackageKind::Library
    );
}

#[test]
fn the_name_of_the_repository_groups_nothing() {
    let result = analyzed(&[
        ("package.json", r#"{ "workspaces": ["packages/*"] }"#),
        ("packages/monorepo-a/package.json", r#"{ "name": "a" }"#),
        ("packages/monorepo-a/index.ts", "export const a = 1\n"),
        ("packages/monorepo-b/package.json", r#"{ "name": "b" }"#),
        ("packages/monorepo-b/index.ts", "export const b = 1\n"),
        ("packages/monorepo-c/package.json", r#"{ "name": "c" }"#),
        ("packages/monorepo-c/index.ts", "export const c = 1\n"),
        ("packages/tools/package.json", r#"{ "name": "tools" }"#),
        ("packages/tools/index.ts", "export const t = 1\n"),
        ("packages/docs/package.json", r#"{ "name": "docs" }"#),
        ("packages/docs/index.ts", "export const d = 1\n"),
    ]);
    // Three of five carry the repository's name, `monorepo`
    assert_eq!(result.packages.dir.len(), 5);
    assert!(result.package_groups.prefix.is_empty());
}

/// An operator whose root module is the app, with an SDK module and a
/// config module inside the SDK, and an end-to-end module of tests.
const OPERATOR: &[(&str, &str)] = &[
    (
        "go.work",
        "go 1.22\n\nuse (\n\t.\n\t./pkg/sdk\n\t./pkg/sdk/config\n\t./e2e\n)\n",
    ),
    ("go.mod", "module example.com/operator\n\ngo 1.22\n"),
    (
        "main.go",
        "package main\n\nimport \"example.com/operator/controllers\"\n\nfunc main() { controllers.Run() }\n",
    ),
    ("cmd/docs.go", "package main\n\nfunc main() {}\n"),
    (
        "controllers/run.go",
        "package controllers\n\nimport \"example.com/operator/pkg/sdk\"\n\nfunc Run() { sdk.Use() }\n",
    ),
    (
        "pkg/sdk/go.mod",
        "module example.com/operator/pkg/sdk\n\ngo 1.22\n",
    ),
    ("pkg/sdk/sdk.go", "package sdk\n\nfunc Use() {}\n"),
    (
        "pkg/sdk/config/go.mod",
        "module example.com/operator/pkg/sdk/config\n\ngo 1.22\n",
    ),
    (
        "pkg/sdk/config/config.go",
        "package config\n\nfunc Load() {}\n",
    ),
    ("e2e/go.mod", "module example.com/operator/e2e\n\ngo 1.22\n"),
    (
        "e2e/run_test.go",
        "package e2e\n\nimport \"testing\"\n\nfunc TestRun(t *testing.T) {}\n",
    ),
];

#[test]
fn a_dot_makes_the_root_a_package_and_modules_nest() {
    let result = analyzed(OPERATOR);
    // e2e holds tests only, but it is not inside another package
    assert_eq!(
        package_paths(&result),
        ["", "e2e", "pkg/sdk", "pkg/sdk/config"]
    );
    let root = row(&result, "");
    assert_eq!(result.packages.kind[root], PackageKind::App);
    // The shallowest program is its entry, not a tool in a folder
    let entry = result.packages.entry[root].unwrap();
    assert_eq!(file_path(&result, entry), "/main.go");
    // Each file counts in the deepest package
    assert_eq!(result.packages.code_files[root], 3);
    assert_eq!(result.packages.code_files[row(&result, "pkg/sdk")], 1);
    assert_eq!(
        result.packages.code_files[row(&result, "pkg/sdk/config")],
        1
    );
    // The root package has no island of its own; the nested module stays on
    // the island of the SDK
    let islands = island_paths(&result);
    assert!(islands.contains(&"pkg/sdk".to_owned()));
    assert!(!islands.contains(&"pkg/sdk/config".to_owned()));
}

#[test]
fn a_package_inside_another_needs_production_code() {
    let mut files = OPERATOR.to_vec();
    files.retain(|(path, _)| *path != "pkg/sdk/config/config.go");
    files.push((
        "pkg/sdk/config/config_test.go",
        "package config\n\nimport \"testing\"\n\nfunc TestLoad(t *testing.T) {}\n",
    ));
    let result = analyzed(&files);
    assert!(!package_paths(&result).contains(&"pkg/sdk/config".to_owned()));
}

#[test]
fn the_root_of_a_javascript_workspace_is_no_package() {
    let result = analyzed(FILES);
    assert!(!package_paths(&result).contains(&String::new()));
}

#[test]
fn packages_that_hold_less_than_half_the_code_make_no_monorepo() {
    // Two extensions are packages, but the editor lies in no package
    let mut files: Vec<(String, String)> = vec![
        (
            "pnpm-workspace.yaml".to_owned(),
            "packages:\n  - 'extensions/*'\n".to_owned(),
        ),
        (
            "extensions/git/package.json".to_owned(),
            r#"{ "name": "git" }"#.to_owned(),
        ),
        (
            "extensions/git/main.ts".to_owned(),
            "export const git = 1\n".to_owned(),
        ),
        (
            "extensions/npm/package.json".to_owned(),
            r#"{ "name": "npm" }"#.to_owned(),
        ),
        (
            "extensions/npm/main.ts".to_owned(),
            "export const npm = 1\n".to_owned(),
        ),
    ];
    for name in ["a", "b", "c", "d", "e"] {
        files.push((
            format!("src/editor/{name}.ts"),
            format!("export const {name} = 1\n"),
        ));
    }
    let files: Vec<(&str, &str)> = files
        .iter()
        .map(|(p, c)| (p.as_str(), c.as_str()))
        .collect();
    let result = analyzed(&files);
    assert_eq!(package_paths(&result), ["extensions/git", "extensions/npm"]);
    // The islands of a simple repository: `extensions` is not split
    assert!(island_paths(&result).contains(&"extensions".to_owned()));
}

/// A Go server at the root and a Vite app in `web`, declared by nothing.
const SERVER_AND_WEB: &[(&str, &str)] = &[
    ("go.mod", "module example.com/notes\n\ngo 1.22\n"),
    (
        "cmd/notes/main.go",
        "package main\n\nimport \"example.com/notes/server\"\n\nfunc main() { server.Run() }\n",
    ),
    ("server/run.go", "package server\n\nfunc Run() {}\n"),
    (
        "web/package.json",
        r#"{ "name": "notes-web", "scripts": { "dev": "vite", "build": "vite build" } }"#,
    ),
    ("web/src/main.ts", "export const app = 1\n"),
    ("web/src/page.ts", "export const page = 1\n"),
];

#[test]
fn projects_nothing_declares_are_implicit_packages() {
    let result = analyzed(SERVER_AND_WEB);
    assert!(result.workspaces.is_empty());
    assert_eq!(package_paths(&result), ["", "web"]);
    let root = row(&result, "");
    assert_eq!(result.packages.kind[root], PackageKind::App);
    let entry = result.packages.entry[root].unwrap();
    assert_eq!(file_path(&result, entry), "cmd/notes/main.go");
    assert_eq!(result.packages.code_files[root], 2);
    assert_eq!(result.packages.kind[row(&result, "web")], PackageKind::App);
    // The app in `web` is an island; the root's folders keep theirs
    let islands = island_paths(&result);
    assert!(islands.contains(&"web".to_owned()));
}

#[test]
fn a_single_project_makes_no_package() {
    let result = analyzed(&[
        ("go.mod", "module example.com/tool\n\ngo 1.22\n"),
        ("main.go", "package main\n\nfunc main() {}\n"),
        ("run/run.go", "package run\n\nfunc Run() {}\n"),
    ]);
    assert!(result.packages.dir.is_empty());
}

#[test]
fn examples_and_tools_config_make_no_implicit_package() {
    let mut files = SERVER_AND_WEB.to_vec();
    files.extend([
        // An example has no production code
        (
            "examples/hello/package.json",
            r#"{ "name": "hello", "scripts": { "start": "node main.js" } }"#,
        ),
        ("examples/hello/main.js", "console.log('hello')\n"),
        // A pyproject.toml that only configures tools, over no Python
        ("scripts/pyproject.toml", "[tool.ruff]\nline-length = 100\n"),
        ("scripts/release.js", "console.log('release')\n"),
    ]);
    let result = analyzed(&files);
    assert_eq!(package_paths(&result), ["", "web"]);
}

#[test]
fn a_declaration_speaks_for_its_language_only() {
    // `go.work` declares the Go modules; the JavaScript front is implicit,
    // and a Go module go.work leaves out stays out
    let result = analyzed(&[
        ("go.work", "go 1.22\n\nuse (\n\t./core\n\t./cli\n)\n"),
        ("core/go.mod", "module example.com/db/core\n\ngo 1.22\n"),
        ("core/main.go", "package main\n\nfunc main() {}\n"),
        ("cli/go.mod", "module example.com/db/cli\n\ngo 1.22\n"),
        ("cli/main.go", "package main\n\nfunc main() {}\n"),
        (
            "desktop/go.mod",
            "module example.com/db/desktop\n\ngo 1.22\n",
        ),
        ("desktop/main.go", "package main\n\nfunc main() {}\n"),
        (
            "frontend/package.json",
            r#"{ "name": "frontend", "scripts": { "dev": "vite" } }"#,
        ),
        ("frontend/src/main.ts", "export const app = 1\n"),
    ]);
    assert_eq!(package_paths(&result), ["cli", "core", "frontend"]);
}

#[test]
fn an_implicit_package_can_lie_inside_a_declared_one() {
    // A uv workspace declares the CLI; its React front has a package.json
    let result = analyzed(&[
        (
            "pyproject.toml",
            "[tool.uv.workspace]\nmembers = [\"cli\", \"lib\"]\n",
        ),
        ("cli/pyproject.toml", "[project]\nname = \"cli\"\n"),
        ("cli/cli/main.py", "print('cli')\n"),
        ("cli/web-ui/package.json", r#"{ "name": "web-ui" }"#),
        ("cli/web-ui/src/app.tsx", "export const App = 1\n"),
        ("lib/pyproject.toml", "[project]\nname = \"lib\"\n"),
        ("lib/lib/core.py", "VALUE = 1\n"),
    ]);
    assert_eq!(package_paths(&result), ["cli", "cli/web-ui", "lib"]);
    assert_eq!(result.packages.code_files[row(&result, "cli")], 1);
}

#[test]
fn a_project_of_the_root_language_is_its_satellite() {
    // A JavaScript library and its documentation site: one project
    let result = analyzed(&[
        (
            "package.json",
            r#"{ "name": "lib", "main": "src/index.js", "scripts": { "start": "jest --watch" } }"#,
        ),
        ("src/index.js", "export const lib = 1\n"),
        ("src/util.js", "export const util = 1\n"),
        (
            "website/package.json",
            r#"{ "name": "lib-website", "scripts": { "start": "docusaurus start" } }"#,
        ),
        ("website/sidebars.js", "module.exports = {}\n"),
    ]);
    assert!(result.packages.dir.is_empty());
}

#[test]
fn a_nested_go_module_is_a_package_of_its_own() {
    // A Go server with its API client as a module of its own, and a UI
    let result = analyzed(&[
        ("go.mod", "module example.com/server\n\ngo 1.22\n"),
        ("main.go", "package main\n\nfunc main() {}\n"),
        ("api/go.mod", "module example.com/server/api\n\ngo 1.22\n"),
        ("api/client.go", "package api\n\nfunc Get() {}\n"),
        (
            "ui/package.json",
            r#"{ "name": "ui", "scripts": { "dev": "vite" } }"#,
        ),
        ("ui/src/main.ts", "export const ui = 1\n"),
    ]);
    assert_eq!(package_paths(&result), ["", "api", "ui"]);
}

#[test]
fn islands_outside_the_packages_have_no_layer() {
    let result = analyzed(&[
        (
            "package.json",
            r#"{ "name": "libs", "private": true, "workspaces": ["libs/*"] }"#,
        ),
        ("libs/a/package.json", r#"{ "name": "a" }"#),
        ("libs/a/index.ts", "export const a = 1\n"),
        ("libs/b/package.json", r#"{ "name": "b" }"#),
        (
            "libs/b/index.ts",
            "import { a } from '../a/index'\nexport const b = a\n",
        ),
        // Production code that imports both, outside the packages
        (
            "cli/run.ts",
            "import { a } from '../libs/a/index'\nimport { b } from '../libs/b/index'\nexport const all = [a, b]\n",
        ),
    ]);
    let layer = |dir: &str| {
        let island = result
            .islands
            .dir
            .iter()
            .position(|&island| dir_path(&result, island) == dir)
            .unwrap();
        result.islands.layer[island]
    };
    assert_eq!(layer("cli"), None);
    assert!(layer("libs/b") > layer("libs/a"));
}

#[test]
fn the_islands_of_a_root_package_keep_their_layer() {
    let result = analyzed(OPERATOR);
    let layer = |dir: &str| {
        let island = result
            .islands
            .dir
            .iter()
            .position(|&island| dir_path(&result, island) == dir)
            .unwrap();
        result.islands.layer[island]
    };
    // `controllers` lies in the root package and imports the SDK
    assert!(layer("controllers").is_some());
    assert!(layer("controllers") > layer("pkg/sdk"));
}

#[test]
fn a_test_that_imports_up_is_no_production_import() {
    let result = analyzed(&[
        (
            "package.json",
            r#"{ "name": "libs", "private": true, "workspaces": ["libs/*"] }"#,
        ),
        ("libs/a/package.json", r#"{ "name": "a" }"#),
        ("libs/a/index.ts", "export const a = 1\n"),
        // The test of `a` uses `b`, above it
        (
            "libs/a/index.test.ts",
            "import { b } from '../b/index'\nexport const checked = b\n",
        ),
        ("libs/b/package.json", r#"{ "name": "b" }"#),
        (
            "libs/b/index.ts",
            "import { a } from '../a/index'\nexport const b = a\n",
        ),
    ]);
    let island = |dir: &str| {
        result
            .islands
            .dir
            .iter()
            .position(|&island| dir_path(&result, island) == dir)
            .unwrap() as u32
    };
    let (a, b) = (island("libs/a"), island("libs/b"));
    let links = &result.links;
    let row = |from: u32, to: u32| {
        (0..links.from.len())
            .find(|&row| links.from[row] == from && links.to[row] == to)
            .unwrap()
    };
    let up = row(a, b);
    assert_eq!((links.imports[up], links.upward[up]), (1, 1));
    assert_eq!((links.production[up], links.production_upward[up]), (0, 0));
    let down = row(b, a);
    assert_eq!(
        (links.production[down], links.production_upward[down]),
        (1, 0)
    );
}
