//! What the graph says about each file: transitive counts, then entry
//! points, foundations and conductors, on small repositories held in
//! memory.

#![allow(clippy::unwrap_used)]

use analyzer::analyze;
use analyzer::files::{Language, SourceFile, count_lines};
use model::EntryReason::{
    self, ConventionalName, Framework, GoMain, MainModule, NoImporter, PackageBin, PackageMain,
    PackageScript, PyprojectScript, SetupCfgScript,
};
use model::{AnalysisResult, Ignored, Repo};

/// Analyzes a repository given as (path, content) pairs.
fn analyzed(files: &[(&str, &str)]) -> AnalysisResult {
    let files = files
        .iter()
        .map(|&(path, content)| SourceFile {
            path: path.to_owned(),
            language: Language::of(path),
            lines: count_lines(content.as_bytes()),
            generated: path.contains("generated"),
            content: Some(content.as_bytes().to_vec()),
        })
        .collect();
    let repo = Repo {
        owner: "acme".to_owned(),
        name: "harbor".to_owned(),
    };
    let result = analyze(repo, "0".repeat(40), files, Ignored::default());
    assert_eq!(result.validate(), Ok(()));
    result
}

fn path_of_dir(result: &AnalysisResult, dir: u32) -> String {
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

fn path_of_file(result: &AnalysisResult, file: u32) -> String {
    let dir = path_of_dir(result, result.files.dir[file as usize]);
    let name = &result.files.name[file as usize];
    if dir.is_empty() {
        name.clone()
    } else {
        format!("{dir}/{name}")
    }
}

/// Each file with its (dependents, dependencies), in path order.
fn counts(result: &AnalysisResult) -> Vec<(String, Option<(u32, u32)>)> {
    (0..result.files.name.len() as u32)
        .map(|file| {
            let counts = result.files.dependents[file as usize]
                .zip(result.files.dependencies[file as usize]);
            (path_of_file(result, file), counts)
        })
        .collect()
}

fn owned(rows: &[(&str, Option<(u32, u32)>)]) -> Vec<(String, Option<(u32, u32)>)> {
    rows.iter()
        .map(|&(path, counts)| (path.to_owned(), counts))
        .collect()
}

#[test]
fn production_files_count_what_they_reach_through_barrels() {
    let result = analyzed(&[
        ("src/main.ts", "import { Store } from './core'\n"),
        (
            "src/core/index.ts",
            "export { Store } from './store'\nexport { clamp } from './utils'\n",
        ),
        (
            "src/core/store.ts",
            "import { clamp } from './utils'\nexport class Store {}\n",
        ),
        ("src/core/utils.ts", "export function clamp() {}\n"),
        (
            "src/core/store.test.ts",
            "import { Store } from './store'\n",
        ),
    ]);
    // `main.ts` goes through the barrel to the store, so nothing reaches
    // the barrel; the barrel still depends on what it re-exports
    assert_eq!(
        counts(&result),
        owned(&[
            ("src/core/index.ts", Some((0, 2))),
            ("src/core/store.test.ts", None),
            ("src/core/store.ts", Some((2, 1))),
            ("src/core/utils.ts", Some((3, 0))),
            ("src/main.ts", Some((0, 2))),
        ])
    );
    assert_eq!(result.files.barrel, [true, false, false, false, false]);
}

#[test]
fn the_files_of_a_go_package_share_its_counts() {
    let result = analyzed(&[
        ("go.mod", "module example.com/harbor\n"),
        (
            "cmd/harbor/main.go",
            "package main\n\nimport \"example.com/harbor/docks\"\n\nfunc main() {}\n",
        ),
        (
            "docks/dock.go",
            "package docks\n\nimport \"example.com/harbor/tides\"\n",
        ),
        ("docks/berth.go", "package docks\n"),
        ("tides/tide.go", "package tides\n"),
    ]);
    assert_eq!(
        counts(&result),
        owned(&[
            ("cmd/harbor/main.go", Some((0, 3))),
            ("docks/berth.go", Some((1, 1))),
            ("docks/dock.go", Some((1, 1))),
            ("go.mod", None),
            ("tides/tide.go", Some((3, 0))),
        ])
    );
}

/// A ranking as (path, count); a Go package's path ends with `/`.
fn ranking(result: &AnalysisResult, ranked: &model::Ranked) -> Vec<(String, u32)> {
    (0..ranked.count.len())
        .map(|row| {
            let path = match (ranked.file[row], ranked.dir[row]) {
                (Some(file), _) => path_of_file(result, file),
                (_, Some(dir)) => format!("{}/", path_of_dir(result, dir)),
                _ => unreachable!(),
            };
            (path, ranked.count[row])
        })
        .collect()
}

fn pairs(rows: &[(&str, u32)]) -> Vec<(String, u32)> {
    rows.iter()
        .map(|&(path, count)| (path.to_owned(), count))
        .collect()
}

#[test]
fn a_barrel_is_never_a_foundation() {
    let whole = "import * as core from '../core'\n";
    let result = analyzed(&[
        (
            "src/core/index.ts",
            "export * from './anchor'\nexport * from './buoy'\n",
        ),
        ("src/core/anchor.ts", "export const ANCHOR = 1\n"),
        ("src/core/buoy.ts", "export const BUOY = 1\n"),
        ("src/fleet/one.ts", whole),
        ("src/fleet/two.ts", whole),
        ("src/fleet/three.ts", whole),
        ("src/fleet/four.ts", whole),
    ]);
    // The barrel has 4 dependents, more than most, but it is a facade
    assert_eq!(
        ranking(&result, &result.roles.foundations),
        pairs(&[("src/core/anchor.ts", 5), ("src/core/buoy.ts", 5)])
    );
}

#[test]
fn ties_go_to_the_most_widely_imported_then_the_path() {
    let result = analyzed(&[
        ("src/apron.ts", "export const A = 1\n"),
        ("src/zenith.ts", "export const Z = 1\n"),
        ("src/p/one.ts", "import { Z } from '../zenith'\n"),
        ("src/q/two.ts", "import { Z } from '../zenith'\n"),
        ("src/p/three.ts", "import { A } from '../apron'\n"),
        ("src/p/four.ts", "import { A } from '../apron'\n"),
    ]);
    // Both have 2 dependents; `zenith.ts` is imported from two folders
    assert_eq!(
        ranking(&result, &result.roles.foundations),
        pairs(&[("src/zenith.ts", 2), ("src/apron.ts", 2)])
    );
    assert_eq!(
        ranking(&result, &result.roles.conductors),
        pairs(&[
            ("src/p/four.ts", 1),
            ("src/p/one.ts", 1),
            ("src/p/three.ts", 1),
            ("src/q/two.ts", 1),
        ])
    );
}

#[test]
fn go_packages_are_ranked_as_folders() {
    let result = analyzed(&[
        ("go.mod", "module example.com/harbor\n"),
        (
            "cmd/harbor/main.go",
            "package main\n\nimport \"example.com/harbor/docks\"\n\nfunc main() {}\n",
        ),
        (
            "docks/dock.go",
            "package docks\n\nimport \"example.com/harbor/tides\"\n",
        ),
        ("docks/berth.go", "package docks\n"),
        ("tides/tide.go", "package tides\n"),
    ]);
    assert_eq!(
        ranking(&result, &result.roles.foundations),
        pairs(&[("tides/", 3), ("docks/", 1)])
    );
    assert_eq!(
        ranking(&result, &result.roles.conductors),
        pairs(&[("cmd/harbor/", 3)])
    );
}

/// Entry points as (path, reasons, command); a Go package's path ends with
/// `/`.
fn entries(result: &AnalysisResult) -> Vec<(String, Vec<EntryReason>, Option<String>)> {
    let entries = &result.roles.entries;
    (0..entries.file.len())
        .map(|row| {
            let path = match (entries.file[row], entries.dir[row]) {
                (Some(file), _) => path_of_file(result, file),
                (_, Some(dir)) => format!("{}/", path_of_dir(result, dir)),
                _ => unreachable!(),
            };
            (
                path,
                entries.reasons[row].clone(),
                entries.command[row].clone(),
            )
        })
        .collect()
}

fn entry(
    path: &str,
    reasons: &[EntryReason],
    command: Option<&str>,
) -> (String, Vec<EntryReason>, Option<String>) {
    (
        path.to_owned(),
        reasons.to_vec(),
        command.map(str::to_owned),
    )
}

#[test]
fn package_json_names_its_commands_and_its_main_module() {
    let result = analyzed(&[
        (
            "package.json",
            r#"{
              "name": "@acme/harbor",
              "bin": { "harbor": "./bin/harbor.js" },
              "main": "./dist/index.js",
              "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
              "scripts": { "start": "node --inspect server.js", "build": "tsc" }
            }"#,
        ),
        ("bin/harbor.js", "require('../dist/index.js')\n"),
        ("server.js", "const app = require('./src/app')\n"),
        ("src/index.ts", "export { Dock } from './dock'\n"),
        ("src/dock.ts", "export class Dock {}\n"),
        ("src/app.js", "module.exports = {}\n"),
        ("test/dock.test.ts", "import { Dock } from '../src/dock'\n"),
    ]);
    // `dist/index.js` is not in the repository: its source is. No one
    // imports `server.js`, which depends on the most
    assert_eq!(
        entries(&result),
        [
            entry(
                "server.js",
                &[PackageScript, NoImporter, ConventionalName],
                None
            ),
            entry("src/index.ts", &[PackageMain, ConventionalName], None),
            entry("bin/harbor.js", &[PackageBin], Some("harbor")),
        ]
    );
}

#[test]
fn python_manifests_and_conventions_give_entry_points() {
    let result = analyzed(&[
        (
            "pyproject.toml",
            "[project]\nname = \"harbor\"\n\n[project.scripts]\nharbor = \"harbor.cli:main\"\n",
        ),
        (
            "setup.cfg",
            "[options.entry_points]\nconsole_scripts =\n    dock = harbor.dock:run\n",
        ),
        ("harbor/__init__.py", ""),
        ("harbor/cli.py", "def main():\n    pass\n"),
        ("harbor/dock.py", "def run():\n    pass\n"),
        ("harbor/__main__.py", "from .cli import main\n\nmain()\n"),
        (
            "harbor/tides.py",
            "def tide():\n    pass\n\nif __name__ == \"__main__\":\n    tide()\n",
        ),
        ("site/manage.py", "import sys\n"),
        ("site/site/wsgi.py", "application = None\n"),
        // A library's adapter, not a Django project's
        (
            "harbor/middleware/wsgi.py",
            "class WSGIMiddleware:\n    pass\n",
        ),
        // Not production code
        (
            "examples/run.py",
            "if __name__ == \"__main__\":\n    pass\n",
        ),
    ]);
    assert_eq!(
        entries(&result),
        [
            entry("harbor/__main__.py", &[MainModule, NoImporter], None),
            entry("harbor/cli.py", &[PyprojectScript], Some("harbor")),
            entry("harbor/dock.py", &[SetupCfgScript], Some("dock")),
            entry("site/manage.py", &[Framework], None),
            entry("site/site/wsgi.py", &[Framework], None),
        ]
    );
}

#[test]
fn a_go_program_is_named_after_its_cmd_folder() {
    let result = analyzed(&[
        ("go.mod", "module example.com/harbor\n"),
        (
            "cmd/harbor/main.go",
            "package main\n\nimport \"example.com/harbor/docks\"\n\nfunc main() {}\n",
        ),
        ("docks/dock.go", "package docks\n"),
    ]);
    assert_eq!(
        entries(&result),
        [entry(
            "cmd/harbor/main.go",
            &[GoMain, NoImporter],
            Some("harbor")
        )]
    );
}

#[test]
fn without_a_manifest_the_graph_guesses_but_never_a_barrel() {
    let result = analyzed(&[
        ("lib/index.ts", "export * from './engine'\n"),
        (
            "lib/engine.ts",
            "import { gear } from './gear'\nexport const engine = gear\n",
        ),
        ("lib/gear.ts", "export const gear = 1\n"),
        ("lib/tools.ts", "import { gear } from './gear'\n"),
    ]);
    // The barrel depends on the most and no one imports it, but it is a
    // facade, and what it re-exports counts as not imported. With no score
    // of 4, the best three are kept
    assert_eq!(
        entries(&result),
        [
            entry("lib/engine.ts", &[NoImporter], None),
            entry("lib/tools.ts", &[NoImporter], None),
        ]
    );
}

#[test]
fn the_order_of_the_files_does_not_change_the_roles() {
    let files = [
        ("go.mod", "module example.com/harbor\n"),
        (
            "cmd/harbor/main.go",
            "package main\n\nimport \"example.com/harbor/docks\"\n\nfunc main() {}\n",
        ),
        ("docks/dock.go", "package docks\n"),
        ("package.json", r#"{ "main": "src/index.ts" }"#),
        ("src/index.ts", "export * from './a'\nexport * from './b'\n"),
        ("src/a.ts", "import { b } from './b'\nexport const a = b\n"),
        ("src/b.ts", "import { a } from './a'\nexport const b = a\n"),
        ("src/c.ts", "import { a } from './index'\n"),
    ];
    let expected = serde_json::to_string(&analyzed(&files)).unwrap();
    let mut shuffled = files;
    shuffled.reverse();
    shuffled.swap(1, 5);
    assert_eq!(
        serde_json::to_string(&analyzed(&shuffled)).unwrap(),
        expected
    );
}

#[test]
fn a_conductor_offered_by_a_barrel_is_still_a_conductor() {
    let result = analyzed(&[
        ("src/index.ts", "export { Harbor } from './harbor'\n"),
        (
            "src/harbor.ts",
            "import { a } from './a'\nimport { b } from './b'\nexport class Harbor {}\n",
        ),
        ("src/a.ts", "export const a = 1\n"),
        ("src/b.ts", "export const b = 1\n"),
        ("src/tool.ts", "import { a } from './a'\n"),
    ]);
    // Only the barrel depends on `harbor.ts`
    assert_eq!(
        ranking(&result, &result.roles.conductors),
        pairs(&[("src/harbor.ts", 2), ("src/tool.ts", 1)])
    );
}

#[test]
fn a_main_compiled_next_to_its_source_is_found() {
    let result = analyzed(&[
        (
            "packages/core/package.json",
            r#"{ "name": "@acme/core", "main": "index.js" }"#,
        ),
        ("packages/core/index.ts", "export { Core } from './core'\n"),
        ("packages/core/core.ts", "export class Core {}\n"),
    ]);
    assert_eq!(
        entries(&result),
        [entry(
            "packages/core/index.ts",
            &[PackageMain, ConventionalName],
            None
        )]
    );
}

#[test]
fn only_the_name_itself_is_conventional() {
    let result = analyzed(&[
        ("src/app.module.ts", "export class AppModule {}\n"),
        ("src/app.controller.ts", "export class AppController {}\n"),
        ("src/main.ts", "export const main = 1\n"),
    ]);
    assert_eq!(
        entries(&result),
        [entry("src/main.ts", &[ConventionalName], None)]
    );
}

#[test]
fn built_code_maps_back_to_its_source_folder_by_folder() {
    let result = analyzed(&[
        ("package.json", r#"{ "main": "./dist/v1.2/index.js" }"#),
        ("src/v1.2/index.ts", "export const v = 1\n"),
        ("src/v1.ts", "export const w = 1\n"),
    ]);
    assert_eq!(
        entries(&result)[0],
        entry("src/v1.2/index.ts", &[PackageMain], None)
    );
}
