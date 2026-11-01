//! Import resolution on small repositories held in memory, one per case.

#![allow(clippy::unwrap_used)]

use analyzer::files::{Language, SourceFile, count_lines};
use analyzer::{ImportReport, analyze_with_report};
use model::{AnalysisResult, Confidence, EdgeKind, Ignored, Repo};

/// Analyzes a repository given as (path, content) pairs.
fn analyze(files: &[(&str, &str)]) -> (AnalysisResult, ImportReport) {
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
        name: "harbor".to_owned(),
    };
    let (result, report) = analyze_with_report(repo, "0".repeat(40), files, Ignored::default());
    assert_eq!(result.validate(), Ok(()));
    (result, report)
}

fn path(result: &AnalysisResult, file: u32) -> String {
    dir_path(result, result.files.dir[file as usize]) + &result.files.name[file as usize]
}

/// The folder's path with a trailing `/`, empty for the root.
fn dir_path(result: &AnalysisResult, dir: u32) -> String {
    let mut parts = Vec::new();
    let mut current = Some(dir);
    while let Some(dir) = current {
        parts.push(result.dirs.name[dir as usize].clone());
        current = result.dirs.parent[dir as usize];
    }
    parts.reverse();
    parts
        .into_iter()
        .filter(|part| !part.is_empty())
        .map(|part| part + "/")
        .collect()
}

/// Every edge as (from, to, kind, confidence), a folder target ending
/// with `/`.
fn edges(result: &AnalysisResult) -> Vec<(String, String, EdgeKind, Confidence)> {
    let edges = &result.edges;
    (0..edges.from.len())
        .map(|row| {
            let to = match (edges.to[row], edges.to_dir[row]) {
                (Some(file), _) => path(result, file),
                (_, Some(dir)) => dir_path(result, dir),
                _ => unreachable!(),
            };
            (
                path(result, edges.from[row]),
                to,
                edges.kind[row],
                edges.confidence[row],
            )
        })
        .collect()
}

fn edge(from: &str, to: &str, kind: EdgeKind) -> (String, String, EdgeKind, Confidence) {
    (from.to_owned(), to.to_owned(), kind, Confidence::Exact)
}

fn likely(from: &str, to: &str) -> (String, String, EdgeKind, Confidence) {
    (
        from.to_owned(),
        to.to_owned(),
        EdgeKind::Import,
        Confidence::Likely,
    )
}

use EdgeKind::{Dynamic, Import, Lazy, Reexport, Type};

#[test]
fn typescript_follows_node_and_typescript_rules() {
    let (result, report) = analyze(&[
        (
            "src/main.ts",
            "import { a } from './a.js'\n\
             import type { B } from './b'\n\
             import './styles/theme.css'\n\
             import { c } from './c'\n\
             import data from './data.json'\n\
             const later = () => import('./lazy')\n\
             import fs from 'node:fs'\n\
             import path from 'path'\n\
             import missing from './missing'\n",
        ),
        ("src/a.ts", "export const a = 1\n"),
        ("src/b.d.ts", "export type B = string\n"),
        ("src/styles/theme.css", "body {}\n"),
        ("src/c/index.tsx", "export const c = 1\n"),
        ("src/data.json", "{}\n"),
        ("src/lazy.ts", "export {}\n"),
    ]);
    assert_eq!(
        edges(&result),
        [
            edge("src/main.ts", "src/a.ts", Import),
            edge("src/main.ts", "src/b.d.ts", Type),
            edge("src/main.ts", "src/c/index.tsx", Import),
            edge("src/main.ts", "src/data.json", Import),
            edge("src/main.ts", "src/lazy.ts", Dynamic),
            edge("src/main.ts", "src/styles/theme.css", Import),
        ]
    );
    assert_eq!(
        (report.exact, report.external, report.unresolved),
        (6, 2, 1)
    );
    assert_eq!(report.unresolved_modules, [("./missing".to_owned(), 1)]);
    assert_eq!(
        (
            result.stats.imports_total,
            result.stats.imports_resolved,
            result.stats.imports_external
        ),
        (9, 6, 2)
    );
}

#[test]
fn the_code_wins_over_its_declaration() {
    let (result, _) = analyze(&[
        (
            "lib/index.js",
            "const util = require('./util')\nimport('./esm.js')\nconst ui = require('ui')\n",
        ),
        ("lib/util.js", "module.exports = {}\n"),
        ("lib/util.d.ts", "export {}\n"),
        ("lib/esm.js", "export {}\n"),
        ("lib/esm.d.ts", "export {}\n"),
        (
            "packages/ui/package.json",
            r#"{ "name": "ui", "types": "index.d.ts", "main": "index.js" }"#,
        ),
        ("packages/ui/index.js", "module.exports = {}\n"),
        ("packages/ui/index.d.ts", "export {}\n"),
        // A declaration alone is still found
        ("src/main.ts", "import { parse } from './semver.js'\n"),
        ("src/semver.d.ts", "export declare function parse(): void\n"),
    ]);
    assert_eq!(
        edges(&result),
        [
            edge("lib/index.js", "lib/esm.js", Dynamic),
            edge("lib/index.js", "lib/util.js", Import),
            edge("lib/index.js", "packages/ui/index.js", Import),
            edge("src/main.ts", "src/semver.d.ts", Import),
        ]
    );
}

#[test]
fn exports_are_read_for_the_code_not_the_types() {
    let (result, report) = analyze(&[
        (
            "packages/ui/package.json",
            r#"{ "name": "@acme/ui", "exports": { ".": { "types": "./dist/index.d.ts", "default": "./src/main.ts" } } }"#,
        ),
        ("packages/ui/src/main.ts", "export const a = 1\n"),
        ("apps/web/main.ts", "import { a } from '@acme/ui'\n"),
    ]);
    assert_eq!(
        edges(&result),
        [edge("apps/web/main.ts", "packages/ui/src/main.ts", Import)]
    );
    assert_eq!(report.unresolved, 0);
}

#[test]
fn tsconfig_paths_are_read_through_extends() {
    let (result, _) = analyze(&[
        (
            "tsconfig.base.json",
            r#"{ "compilerOptions": { "baseUrl": ".", "paths": { "@app/*": ["src/app/*"] } } }"#,
        ),
        (
            "tsconfig.json",
            "{\n  // comments are allowed\n  \"extends\": \"./tsconfig.base.json\",\n  \"include\": [\"src\"]\n}\n",
        ),
        (
            "src/main.ts",
            "import { store } from '@app/store'\nimport { util } from 'src/util'\n",
        ),
        ("src/app/store.ts", "export const store = 1\n"),
        ("src/util.ts", "export const util = 1\n"),
    ]);
    assert_eq!(
        edges(&result),
        [
            edge("src/main.ts", "src/app/store.ts", Import),
            edge("src/main.ts", "src/util.ts", Import),
        ]
    );
}

#[test]
fn a_tsconfig_extending_a_missing_package_keeps_its_own_paths() {
    let (result, report) = analyze(&[
        (
            "tsconfig.json",
            "{\n  // the parent is a package, not in the repository\n  \"extends\": \"@vue/tsconfig/tsconfig.dom.json\",\n  \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@lib/*\": [\"shared/lib/*\"] } },\n}\n",
        ),
        (
            "apps/tsconfig.json",
            r#"{ "extends": ["@tsconfig/strictest", "../tsconfig.base.json", "./missing.json"], "compilerOptions": { "paths": { "@apps/*": ["./*"] } } }"#,
        ),
        (
            "tsconfig.base.json",
            r#"{ "compilerOptions": { "strict": true } }"#,
        ),
        (
            "src/main.ts",
            "import { a } from '@lib/a'\nimport { b } from './b'\n",
        ),
        ("src/b.ts", "export const b = 1\n"),
        ("shared/lib/a.ts", "export const a = 1\n"),
        ("apps/web/main.ts", "import { c } from '@apps/web/c'\n"),
        ("apps/web/c.ts", "export const c = 1\n"),
    ]);
    assert_eq!(
        edges(&result),
        [
            edge("apps/web/main.ts", "apps/web/c.ts", Import),
            edge("src/main.ts", "shared/lib/a.ts", Import),
            edge("src/main.ts", "src/b.ts", Import),
        ]
    );
    assert_eq!((report.exact, report.external), (3, 0));
}

#[test]
fn a_jsconfig_alone_is_read_like_a_tsconfig() {
    let (result, _) = analyze(&[
        (
            "jsconfig.json",
            r#"{ "compilerOptions": { "baseUrl": ".", "paths": { "@components/*": ["app/ui/*"] } } }"#,
        ),
        (
            "pages/index.jsx",
            "import Button from '@components/Button'\n",
        ),
        ("app/ui/Button.jsx", "export default 1\n"),
        // Next to a tsconfig, a jsconfig is not read
        (
            "web/tsconfig.json",
            r#"{ "compilerOptions": { "baseUrl": "." } }"#,
        ),
        (
            "web/jsconfig.json",
            r#"{ "compilerOptions": { "baseUrl": ".", "paths": { "@x/*": ["x/*"] } } }"#,
        ),
        ("web/main.js", "import x from '@x/y'\n"),
        ("web/x/y.js", "export default 1\n"),
    ]);
    assert_eq!(
        edges(&result),
        [edge("pages/index.jsx", "app/ui/Button.jsx", Import)]
    );
}

#[test]
fn workspace_packages_resolve_to_their_sources() {
    let (result, report) = analyze(&[
        (
            "package.json",
            r#"{ "name": "root", "private": true, "devDependencies": { "typescript": "5" } }"#,
        ),
        (
            "packages/ui/package.json",
            r#"{ "name": "@acme/ui", "main": "dist/index.js", "dependencies": { "react": "19" } }"#,
        ),
        ("packages/ui/src/index.ts", "export * from './button'\n"),
        (
            "packages/ui/src/button.tsx",
            "import React from 'react'\nexport const Button = 1\n",
        ),
        (
            "apps/web/main.ts",
            "import { Button } from '@acme/ui'\nimport { b } from '@acme/ui/button'\nimport ts from 'typescript'\nimport { x } from '@other/lib'\n",
        ),
        // `main` names a build that is not in the repository
        (
            "tools/package.json",
            r#"{ "name": "tools", "main": "out/index.js" }"#,
        ),
        ("tools/index.js", "module.exports = {}\n"),
        ("scripts/run.js", "const tools = require('../tools')\n"),
    ]);
    assert_eq!(
        edges(&result),
        [
            edge("apps/web/main.ts", "packages/ui/src/button.tsx", Import),
            edge("apps/web/main.ts", "packages/ui/src/index.ts", Import),
            edge(
                "packages/ui/src/index.ts",
                "packages/ui/src/button.tsx",
                Reexport
            ),
            edge("scripts/run.js", "tools/index.js", Import),
        ]
    );
    // react and typescript are declared, @other/lib is not but looks like a package
    assert_eq!((report.external, report.unresolved), (3, 0));
}

#[test]
fn a_package_imports_itself_through_its_exports() {
    let (result, report) = analyze(&[
        (
            "package.json",
            r#"{
                "name": "three",
                "main": "./build/three.cjs",
                "exports": {
                    ".": { "import": "./build/three.module.js", "require": "./build/three.cjs" },
                    "./webgpu": "./build/three.webgpu.js",
                    "./addons/*": "./examples/jsm/*"
                },
                "devDependencies": { "typescript": "5" }
            }"#,
        ),
        ("src/Three.js", "export * from './core.js'\n"),
        ("src/Three.WebGPU.js", "export {}\n"),
        ("src/core.js", "export {}\n"),
        (
            "examples/jsm/controls/Orbit.js",
            "import { a } from 'three'\n",
        ),
        (
            "examples/app.js",
            "import * as THREE from 'three'\nimport { WebGPURenderer } from 'three/webgpu'\nimport { Orbit } from 'three/addons/controls/Orbit.js'\nimport ts from 'typescript'\n",
        ),
        // An extension named like a package the repository depends on
        (
            "extensions/typescript/package.json",
            r#"{ "name": "typescript" }"#,
        ),
        ("extensions/typescript/grammar.json", "{}\n"),
    ]);
    assert_eq!(
        edges(&result),
        [
            edge("examples/app.js", "examples/jsm/controls/Orbit.js", Import),
            likely("examples/app.js", "src/Three.WebGPU.js"),
            likely("examples/app.js", "src/Three.js"),
            likely("examples/jsm/controls/Orbit.js", "src/Three.js"),
            edge("src/Three.js", "src/core.js", Reexport),
        ]
    );
    assert_eq!((report.external, report.unresolved), (1, 0));
}

#[test]
fn an_unknown_alias_is_matched_by_suffix_when_only_one_file_fits() {
    let (result, report) = analyze(&[
        (
            "src/main.ts",
            "import { a } from '@/components/Button'\nimport { b } from '~/util'\nimport redis from 'redis'\n",
        ),
        // A package declared nowhere, named like a file
        ("examples/redis.js", "module.exports = {}\n"),
        ("src/components/Button.tsx", "export const a = 1\n"),
        ("src/util.ts", "export const b = 1\n"),
        ("lib/util.ts", "export const b = 1\n"),
    ]);
    assert_eq!(
        edges(&result),
        [likely("src/main.ts", "src/components/Button.tsx")]
    );
    assert_eq!(
        (report.likely, report.unresolved, report.external),
        (1, 1, 1)
    );
    assert_eq!(report.unresolved_modules, [("~/util".to_owned(), 1)]);
}

#[test]
fn imports_of_the_same_file_make_one_edge_with_the_strongest_kind() {
    let (result, report) = analyze(&[
        (
            "src/index.ts",
            "import type { A } from './a'\nexport { a } from './a'\nimport { b } from './a'\nimport { self } from './index'\n",
        ),
        ("src/a.ts", "export const a = 1\n"),
    ]);
    assert_eq!(edges(&result), [edge("src/index.ts", "src/a.ts", Reexport)]);
    // The import of itself counts as resolved, but makes no edge
    assert_eq!(report.exact, 4);
    assert_eq!(result.stats.imports_resolved, 4);
}

#[test]
fn python_resolves_packages_from_their_roots() {
    let (result, report) = analyze(&[
        ("pyproject.toml", "[project]\nname = \"harbor\"\n"),
        ("src/harbor/__init__.py", "from .docks import Dock\n"),
        (
            "src/harbor/docks.py",
            "from __future__ import annotations\n\
             from typing import TYPE_CHECKING\n\
             import os\n\
             from harbor import tides\n\
             from . import cranes, MAX\n\
             from .ships.hull import Hull\n\
             if TYPE_CHECKING:\n    from harbor.charts import Chart\n\
             def load():\n    import harbor.cargo\n",
        ),
        ("src/harbor/tides.py", "LOW = 1\n"),
        ("src/harbor/cranes.py", "class Crane: pass\n"),
        ("src/harbor/charts.py", "class Chart: pass\n"),
        ("src/harbor/cargo.py", "def load(): pass\n"),
        ("src/harbor/ships/__init__.py", ""),
        (
            "src/harbor/ships/hull.py",
            "from ..tides import LOW\nfrom ... import nowhere\n",
        ),
        (
            "tests/test_docks.py",
            "from harbor.docks import Dock\nimport helpers\nimport harbor.missing\n",
        ),
        ("tests/helpers.py", "def helper(): pass\n"),
        // A folder of examples named like the package they use
        (
            "docs/opentelemetry/tutorial.py",
            "import opentelemetry.trace\n",
        ),
    ]);
    assert_eq!(
        edges(&result),
        [
            edge("src/harbor/__init__.py", "src/harbor/docks.py", Reexport),
            edge("src/harbor/docks.py", "src/harbor/__init__.py", Import),
            edge("src/harbor/docks.py", "src/harbor/cargo.py", Lazy),
            edge("src/harbor/docks.py", "src/harbor/charts.py", Type),
            edge("src/harbor/docks.py", "src/harbor/cranes.py", Import),
            edge("src/harbor/docks.py", "src/harbor/ships/hull.py", Import),
            edge("src/harbor/docks.py", "src/harbor/tides.py", Import),
            edge("src/harbor/ships/hull.py", "src/harbor/tides.py", Import),
            edge("tests/test_docks.py", "src/harbor/docks.py", Import),
            likely("tests/test_docks.py", "tests/helpers.py"),
        ]
    );
    // os, typing and opentelemetry are outside; `from ... import` climbs
    // to `src`, which is not a package, and `harbor.missing` does not exist
    assert_eq!((report.external, report.unresolved), (3, 2));
}

#[test]
fn go_imports_point_to_the_package_folder() {
    let (result, report) = analyze(&[
        ("go.mod", "module github.com/acme/harbor\n\ngo 1.22\n"),
        (
            "main.go",
            "package main\n\nimport (\n\t\"fmt\"\n\t\"github.com/acme/harbor/tide\"\n\t\"github.com/acme/harbor/tools/gen\"\n\t\"github.com/acme/harbor/missing\"\n\t\"github.com/gin-gonic/gin\"\n)\n",
        ),
        ("tide/tide.go", "package tide\n"),
        (
            "tide/tide_test.go",
            "package tide_test\n\nimport \"github.com/acme/harbor/tide\"\n",
        ),
        ("tools/go.mod", "module github.com/acme/harbor/tools\n"),
        ("tools/gen/gen.go", "package gen\n"),
    ]);
    assert_eq!(
        edges(&result),
        [
            edge("main.go", "tide/", Import),
            edge("main.go", "tools/gen/", Import),
            edge("tide/tide_test.go", "tide/", Import),
        ]
    );
    assert_eq!((report.external, report.unresolved), (2, 1));
}

#[test]
fn the_order_of_the_files_does_not_change_the_edges() {
    let mut files = vec![
        ("go.mod", "module x\n"),
        ("a/a.go", "package a\nimport \"x/b\"\n"),
        ("b/b.go", "package b\n"),
        ("web/main.ts", "import './b'\nimport './a'\n"),
        ("web/a.ts", "import './b'\n"),
        ("web/b.ts", "export {}\n"),
        ("py/m.py", "from . import n\n"),
        ("py/n.py", "import m\n"),
    ];
    let expected = serde_json::to_string(&analyze(&files).0).unwrap();
    files.reverse();
    files.swap(1, 5);
    assert_eq!(serde_json::to_string(&analyze(&files).0).unwrap(), expected);
}
