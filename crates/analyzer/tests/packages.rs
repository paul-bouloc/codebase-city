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
    let workspace = result.workspace.as_ref().unwrap();
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
    assert!(result.workspace.is_none());
    assert!(result.packages.dir.is_empty());
    assert_eq!(result.externals.name, ["pydantic", "starlette"]);
    assert_eq!(result.externals.files, [2, 1]);
    assert_eq!(result.externals.package, [None, None]);
}
