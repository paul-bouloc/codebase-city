//! The structure of a repository: islands, their layers, the imports
//! between them and the loops of imports, on a small repository held in
//! memory.

#![allow(clippy::unwrap_used)]

use analyzer::analyze;
use analyzer::files::{Language, SourceFile, count_lines};
use model::{AnalysisResult, Ignored, Repo};

/// `src` holds all the production code, so its folders are islands: `core`
/// at the bottom, `ui` on it, `app` on top of both, and `main.ts` above.
/// `store.ts` and `events.ts` import each other; `legacy.ts` imports the
/// layer above its own. `scripts` is tooling nothing imports.
const FILES: &[(&str, &str)] = &[
    ("package.json", "{ \"main\": \"src/main.ts\" }\n"),
    (
        "scripts/release.ts",
        "import { App } from '../src/app/app'\n",
    ),
    ("src/main.ts", "import { App } from './app/app'\n"),
    (
        "src/app/app.ts",
        "import { View } from '../ui/view'\nimport { Store } from '../core'\nexport class App {}\n",
    ),
    (
        "src/core/index.ts",
        "export { Store } from './store'\nexport { emit } from './events'\n",
    ),
    (
        "src/core/store.ts",
        "import { emit } from './events'\nexport class Store {}\n",
    ),
    (
        "src/core/events.ts",
        "import { Store } from './store'\nexport function emit() {}\n",
    ),
    (
        "src/core/legacy.ts",
        "import { View } from '../ui/view'\nexport const old = 1\n",
    ),
    (
        "src/ui/view.ts",
        "import { Store } from '../core/store'\nimport { emit } from '../core/events'\nexport class View {}\n",
    ),
    (
        "test/store.test.ts",
        "import { Store } from '../src/core/store'\n",
    ),
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
        name: "harbor".to_owned(),
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
    let dir = dir_path(result, result.files.dir[file as usize]);
    let name = &result.files.name[file as usize];
    if dir.is_empty() {
        name.clone()
    } else {
        format!("{dir}/{name}")
    }
}

fn island_name(result: &AnalysisResult, island: u32) -> String {
    dir_path(result, result.islands.dir[island as usize])
}

#[test]
fn a_folder_with_most_of_the_code_is_split_into_islands() {
    let result = analyzed(FILES);
    let islands: Vec<(String, Option<u32>)> = (0..result.islands.dir.len() as u32)
        .map(|island| {
            (
                island_name(&result, island),
                result.islands.layer[island as usize],
            )
        })
        .collect();
    let expected = [
        ("", None),
        ("scripts", None),
        ("src", Some(4)),
        ("src/app", Some(3)),
        ("src/core", Some(1)),
        ("src/ui", Some(2)),
        ("test", None),
    ];
    let expected: Vec<(String, Option<u32>)> = expected
        .iter()
        .map(|&(name, layer)| (name.to_owned(), layer))
        .collect();
    assert_eq!(islands, expected);
    // Every folder holds its own files in the island named after it
    for dir in 0..result.dirs.name.len() as u32 {
        let island = result.dirs.island[dir as usize].unwrap();
        assert_eq!(island_name(&result, island), dir_path(&result, dir));
    }
}

#[test]
fn links_count_every_import_between_two_islands() {
    let result = analyzed(FILES);
    let links: Vec<(String, String, u32, u32)> = (0..result.links.from.len())
        .map(|row| {
            let (from, to) = (result.links.from[row], result.links.to[row]);
            (
                island_name(&result, from),
                island_name(&result, to),
                result.links.imports[row],
                result.links.upward[row],
            )
        })
        .collect();
    let expected = [
        ("scripts", "src/app", 1, 0),
        ("src", "src/app", 1, 0),
        ("src/app", "src/core", 1, 0),
        ("src/app", "src/ui", 1, 0),
        // `legacy.ts` goes up a layer
        ("src/core", "src/ui", 1, 1),
        ("src/ui", "src/core", 2, 0),
        ("test", "src/core", 1, 0),
    ];
    let expected: Vec<(String, String, u32, u32)> = expected
        .iter()
        .map(|&(from, to, imports, upward)| (from.to_owned(), to.to_owned(), imports, upward))
        .collect();
    assert_eq!(links, expected);
}

#[test]
fn files_that_import_each_other_make_a_cycle() {
    let result = analyzed(FILES);
    let paths = |files: &[u32]| -> Vec<String> {
        files.iter().map(|&file| file_path(&result, file)).collect()
    };
    assert_eq!(result.cycles.members.len(), 1);
    assert_eq!(
        paths(&result.cycles.members[0]),
        ["src/core/events.ts", "src/core/store.ts"]
    );
    assert_eq!(
        paths(&result.cycles.shortest[0]),
        ["src/core/events.ts", "src/core/store.ts"]
    );
}

#[test]
fn a_lazy_import_or_a_barrel_makes_no_cycle() {
    let result = analyzed(&[
        ("a.py", "import b\n\ndef run():\n    import c\n"),
        ("b.py", "import a\n"),
        ("c.py", "import a\n"),
        ("lib/index.ts", "export { x } from './x'\n"),
        (
            "lib/x.ts",
            "import * as all from './index'\nexport const x = 1\n",
        ),
    ]);
    let paths: Vec<Vec<String>> = result
        .cycles
        .members
        .iter()
        .map(|files| files.iter().map(|&file| file_path(&result, file)).collect())
        .collect();
    assert_eq!(paths, [["a.py", "b.py"]]);
}

#[test]
fn the_order_of_the_files_does_not_matter() {
    let expected = serde_json::to_string(&analyzed(FILES)).unwrap();
    let mut files = FILES.to_vec();
    files.reverse();
    files.swap(2, 7);
    assert_eq!(serde_json::to_string(&analyzed(&files)).unwrap(), expected);
}
