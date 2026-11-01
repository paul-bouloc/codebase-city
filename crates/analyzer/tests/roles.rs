//! What the graph says about each file: transitive counts, then entry
//! points, foundations and conductors, on small repositories held in
//! memory.

#![allow(clippy::unwrap_used)]

use analyzer::analyze;
use analyzer::files::{Language, SourceFile, count_lines};
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
