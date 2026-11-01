//! The import graph, barrels seen through, on small repositories held in
//! memory, one per case.

#![allow(clippy::unwrap_used)]

use analyzer::files::{Language, SourceFile, count_lines};
use analyzer::graph::Node;
use analyzer::{Report, analyze_with_report};
use model::{AnalysisResult, Confidence, EdgeKind, Ignored, Repo};

fn source_files(files: &[(&str, &str)]) -> Vec<SourceFile> {
    files
        .iter()
        .map(|&(path, content)| SourceFile {
            path: path.to_owned(),
            language: Language::of(path),
            lines: count_lines(content.as_bytes()),
            generated: path.contains("generated"),
            content: Some(content.as_bytes().to_vec()),
        })
        .collect()
}

/// Analyzes a repository given as (path, content) pairs.
fn analyze(files: &[(&str, &str)]) -> (AnalysisResult, Report) {
    let repo = Repo {
        owner: "acme".to_owned(),
        name: "harbor".to_owned(),
    };
    let (result, report) = analyze_with_report(
        repo,
        "0".repeat(40),
        source_files(files),
        Ignored::default(),
    );
    assert_eq!(result.validate(), Ok(()));
    (result, report)
}

fn path(result: &AnalysisResult, node: Node) -> String {
    let (mut dir, name) = match node {
        Node::File(file) => (
            Some(result.files.dir[file as usize]),
            result.files.name[file as usize].clone(),
        ),
        Node::Dir(dir) => (
            result.dirs.parent[dir as usize],
            format!("{}/", result.dirs.name[dir as usize]),
        ),
    };
    let mut parts = vec![name];
    while let Some(row) = dir {
        if row != 0 {
            parts.push(result.dirs.name[row as usize].clone());
        }
        dir = result.dirs.parent[row as usize];
    }
    parts.reverse();
    parts.join("/")
}

/// Every edge of the graph from `from`, as (target, through a barrel).
fn edges_from(result: &AnalysisResult, report: &Report, from: &str) -> Vec<(String, bool)> {
    let file = file_row(result, from);
    report
        .graph
        .edges(file)
        .iter()
        .map(|edge| (path(result, edge.to), edge.via_barrel))
        .collect()
}

/// Every edge of the production graph, as (from, to).
fn production(result: &AnalysisResult, report: &Report) -> Vec<(String, String)> {
    (0..report.graph.file_count() as u32)
        .flat_map(|file| {
            report
                .graph
                .production_edges(file)
                .map(move |edge| (path(result, Node::File(file)), path(result, edge.to)))
        })
        .collect()
}

fn file_row(result: &AnalysisResult, wanted: &str) -> u32 {
    (0..result.files.name.len() as u32)
        .find(|&file| path(result, Node::File(file)) == wanted)
        .unwrap()
}

fn through(paths: &[&str]) -> Vec<(String, bool)> {
    paths
        .iter()
        .map(|path| ((*path).to_owned(), true))
        .collect()
}

#[test]
fn named_imports_go_through_a_barrel_to_their_files() {
    let (result, report) = analyze(&[
        (
            "src/app.ts",
            "import { Store, View } from './lib'\nimport type { Props } from './lib'\n",
        ),
        (
            "src/lib/index.ts",
            "export { Store } from './store'\nexport * from './view'\nexport type { Props } from './props'\n",
        ),
        ("src/lib/store.ts", "export class Store {}\n"),
        ("src/lib/view.ts", "export class View {}\n"),
        ("src/lib/props.ts", "export interface Props {}\n"),
    ]);
    assert!(
        report
            .graph
            .is_barrel(file_row(&result, "src/lib/index.ts"))
    );
    assert_eq!(
        edges_from(&result, &report, "src/app.ts"),
        through(&["src/lib/props.ts", "src/lib/store.ts", "src/lib/view.ts"])
    );
    // The barrel keeps its own edges, and the result its real imports
    assert_eq!(edges_from(&result, &report, "src/lib/index.ts").len(), 3);
    assert_eq!(result.edges.from.len(), 4);
    let file = file_row(&result, "src/app.ts");
    let props = file_row(&result, "src/lib/props.ts");
    let edge = report.graph.edges(file)[0];
    assert_eq!(edge.to, Node::File(props));
    assert_eq!(edge.kind, EdgeKind::Type);
    assert_eq!(edge.confidence, Confidence::Exact);
    assert_eq!(report.barrels.barrels, 1);
    assert_eq!(report.barrels.names_through, 3);
}

#[test]
fn barrels_are_followed_through_several_levels_and_aliases() {
    let (result, report) = analyze(&[
        (
            "app.ts",
            "import { clamp, Line, Ship } from './lib'\nimport Mast from './lib'\n",
        ),
        (
            "lib/index.ts",
            "export * from './core'\nexport { Rope as Line } from './rope'\nexport { default } from './mast'\nexport { Ship } from './fleet'\n",
        ),
        ("lib/core/index.ts", "export * from './math'\n"),
        ("lib/core/math.ts", "export function clamp() {}\n"),
        ("lib/rope.ts", "export class Rope {}\n"),
        ("lib/mast.ts", "export default class Mast {}\n"),
        // A barrel that is not one: it declares what it exports
        (
            "lib/fleet.ts",
            "export class Ship {}\nexport * from './rope'\n",
        ),
    ]);
    assert_eq!(
        edges_from(&result, &report, "app.ts"),
        through(&[
            "lib/core/math.ts",
            "lib/fleet.ts",
            "lib/mast.ts",
            "lib/rope.ts"
        ])
    );
}

#[test]
fn an_import_of_the_whole_barrel_stays_on_it() {
    let (result, report) = analyze(&[
        (
            "app.ts",
            "import * as lib from './lib'\nimport './lib/setup'\n",
        ),
        ("main.js", "const lib = require('./lib')\n"),
        ("lib/index.ts", "export * from './store'\n"),
        ("lib/setup.ts", "export * from './store'\n"),
        ("lib/store.ts", "export class Store {}\n"),
    ]);
    assert_eq!(
        edges_from(&result, &report, "app.ts"),
        [
            ("lib/index.ts".to_owned(), false),
            ("lib/setup.ts".to_owned(), false)
        ]
    );
    assert_eq!(
        edges_from(&result, &report, "main.js"),
        [("lib/index.ts".to_owned(), false)]
    );
    assert_eq!(report.barrels.whole_imports, 3);
}

#[test]
fn a_loop_or_an_ambiguous_name_stays_on_the_barrel() {
    let (result, report) = analyze(&[
        (
            "app.ts",
            "import { Lost } from './a'\nimport { dup } from './both'\n",
        ),
        ("a/index.ts", "export * from '../b'\n"),
        ("b/index.ts", "export * from '../a'\n"),
        (
            "both/index.ts",
            "export * from './x'\nexport * from './y'\n",
        ),
        ("both/x.ts", "export const dup = 1\n"),
        ("both/y.ts", "export const dup = 2\n"),
    ]);
    assert_eq!(
        edges_from(&result, &report, "app.ts"),
        [
            ("a/index.ts".to_owned(), false),
            ("both/index.ts".to_owned(), false)
        ]
    );
    assert_eq!(report.barrels.names_missing, 1);
    assert_eq!(report.barrels.names_ambiguous, 1);
}

#[test]
fn a_python_package_is_seen_through() {
    let (result, report) = analyze(&[
        ("app.py", "from harbor import Dock, tides\nimport harbor\n"),
        (
            "harbor/__init__.py",
            "\"\"\"The harbor.\"\"\"\nfrom .docks import Dock\nfrom . import tides\n__all__ = ['Dock', 'tides']\n",
        ),
        ("harbor/docks.py", "class Dock:\n    pass\n"),
        ("harbor/tides.py", "def rise():\n    pass\n"),
    ]);
    assert!(
        report
            .graph
            .is_barrel(file_row(&result, "harbor/__init__.py"))
    );
    let edges = edges_from(&result, &report, "app.py");
    // `import harbor` binds the package itself
    assert!(edges.contains(&("harbor/__init__.py".to_owned(), false)));
    assert!(edges.contains(&("harbor/docks.py".to_owned(), true)));
    assert!(edges.iter().any(|(path, _)| path == "harbor/tides.py"));
}

#[test]
fn the_production_graph_keeps_the_code_the_project_ships() {
    let (result, report) = analyze(&[
        (
            "src/app.ts",
            "import { Store } from './store'\nimport { Schema } from './generated/schema'\nimport { util } from '../build/util'\n",
        ),
        ("src/store.ts", "export class Store {}\n"),
        ("src/generated/schema.ts", "export type Schema = {}\n"),
        ("build/util.ts", "export const util = 1\n"),
        ("test/app.test.ts", "import { Store } from '../src/store'\n"),
        ("examples/demo.ts", "import { Store } from '../src/store'\n"),
        ("go.mod", "module example.com/harbor\n"),
        (
            "main.go",
            "package main\n\nimport (\n\t\"example.com/harbor/tide\"\n\t\"example.com/harbor/testdata/fake\"\n)\n",
        ),
        ("tide/tide.go", "package tide\n"),
        ("testdata/fake/fake.go", "package fake\n"),
    ]);
    assert_eq!(
        production(&result, &report),
        [
            ("main.go".to_owned(), "tide/".to_owned()),
            ("src/app.ts".to_owned(), "src/store.ts".to_owned()),
        ]
    );
    assert!(
        !report
            .graph
            .is_production(file_row(&result, "test/app.test.ts"))
    );
    assert!(report.graph.is_production(file_row(&result, "src/app.ts")));
    // The whole graph keeps them
    assert_eq!(edges_from(&result, &report, "src/app.ts").len(), 3);
}

#[test]
fn the_order_of_the_files_does_not_matter() {
    let files = [
        ("app.ts", "import { clamp, Line } from './lib'\n"),
        (
            "lib/index.ts",
            "export * from './math'\nexport { Rope as Line } from './rope'\n",
        ),
        ("lib/math.ts", "export function clamp() {}\n"),
        ("lib/rope.ts", "export class Rope {}\n"),
        ("test/app.test.ts", "import { clamp } from '../lib'\n"),
    ];
    let (_, expected) = analyze(&files);
    let mut reversed = files;
    reversed.reverse();
    let (_, report) = analyze(&reversed);
    assert_eq!(report.graph, expected.graph);
    assert_eq!(report.barrels, expected.barrels);
}

#[test]
fn diamonds_of_reexports_are_followed_once() {
    // Each level re-exports several files that all re-export the next
    // level: without memory, a lookup would walk SIDES^LEVELS chains
    const LEVELS: usize = 10;
    const SIDES: usize = 8;
    let mut files = vec![(
        "app.ts".to_owned(),
        "import { deep } from './l0/index'\n".to_owned(),
    )];
    for level in 0..LEVELS {
        let sides: String = (0..SIDES)
            .map(|side| format!("export * from './s{side}'\n"))
            .collect();
        files.push((format!("l{level}/index.ts"), sides));
        for side in 0..SIDES {
            files.push((
                format!("l{level}/s{side}.ts"),
                format!("export * from '../l{}/index'\n", level + 1),
            ));
        }
    }
    files.push((
        format!("l{LEVELS}/index.ts"),
        "export const deep = 1\n".to_owned(),
    ));
    let files: Vec<(&str, &str)> = files
        .iter()
        .map(|(path, content)| (path.as_str(), content.as_str()))
        .collect();
    let (result, report) = analyze(&files);
    assert_eq!(
        edges_from(&result, &report, "app.ts"),
        through(&["l10/index.ts"])
    );
}

#[test]
fn a_barrel_built_to_make_lookups_slow_does_not_hold_the_analysis() {
    // Every missing name is looked up in every target: steps grow with the
    // square of the barrel, and stop at a budget
    const TARGETS: usize = 3_000;
    let names: Vec<String> = (0..TARGETS).map(|n| format!("n{n}")).collect();
    let mut files = vec![
        (
            "app.ts".to_owned(),
            format!("import {{ {} }} from './b'\n", names.join(", ")),
        ),
        (
            "b.ts".to_owned(),
            (0..TARGETS)
                .map(|n| format!("export * from './f/f{n}'\n"))
                .collect(),
        ),
    ];
    for n in 0..TARGETS {
        files.push((format!("f/f{n}.ts"), format!("export const x{n} = 1\n")));
    }
    let files: Vec<(&str, &str)> = files
        .iter()
        .map(|(path, content)| (path.as_str(), content.as_str()))
        .collect();
    let started = std::time::Instant::now();
    let (result, report) = analyze(&files);
    assert!(started.elapsed() < std::time::Duration::from_secs(10));
    assert_eq!(report.barrels.steps, 2_000_000);
    assert_eq!(
        edges_from(&result, &report, "app.ts"),
        [("b.ts".to_owned(), false)]
    );
}

#[test]
fn each_name_of_a_python_import_goes_with_its_own_module() {
    let (result, report) = analyze(&[
        ("app.py", "from pkg import engine, run\n"),
        ("pkg/__init__.py", "from .core import engine, run\n"),
        ("pkg/core/__init__.py", "def run():\n    pass\n"),
        ("pkg/core/engine.py", "class Engine:\n    pass\n"),
    ]);
    assert_eq!(
        edges_from(&result, &report, "app.py"),
        through(&["pkg/core/__init__.py", "pkg/core/engine.py"])
    );
    assert_eq!(report.barrels.names_missing, 0);
}

#[test]
fn a_package_of_many_modules_stays_linear() {
    const MODULES: usize = 3_000;
    let names: Vec<String> = (0..MODULES).map(|n| format!("m{n}")).collect();
    let mut files = vec![
        ("app.py".to_owned(), "from pkg import m0\n".to_owned()),
        (
            "pkg/__init__.py".to_owned(),
            format!("from . import {}\n", names.join(", ")),
        ),
    ];
    for name in &names {
        files.push((format!("pkg/{name}.py"), "def f():\n    pass\n".to_owned()));
    }
    let files: Vec<(&str, &str)> = files
        .iter()
        .map(|(path, content)| (path.as_str(), content.as_str()))
        .collect();
    let started = std::time::Instant::now();
    let (result, report) = analyze(&files);
    assert!(started.elapsed() < std::time::Duration::from_secs(10));
    assert_eq!(
        edges_from(&result, &report, "app.py"),
        [("pkg/m0.py".to_owned(), false)]
    );
}

#[test]
fn a_loop_of_reexports_does_not_depend_on_who_looks_first() {
    let files = [
        ("a.ts", "export * from './b'\nexport * from './c'\n"),
        ("b.ts", "export * from './a'\n"),
        ("c.ts", "export const X = 1\n"),
        ("m1.ts", "import { X } from './a'\n"),
        ("m2.ts", "import { X } from './b'\n"),
    ];
    let (result, report) = analyze(&files);
    assert_eq!(edges_from(&result, &report, "m1.ts"), through(&["c.ts"]));
    assert_eq!(edges_from(&result, &report, "m2.ts"), through(&["c.ts"]));
}

#[test]
fn a_python_package_reexporting_by_absolute_imports_is_seen_through() {
    let (result, report) = analyze(&[
        ("app.py", "from harbor import Dock\n"),
        ("harbor/__init__.py", "from harbor.docks import Dock\n"),
        ("harbor/docks.py", "class Dock:\n    pass\n"),
    ]);
    assert_eq!(
        edges_from(&result, &report, "app.py"),
        through(&["harbor/docks.py"])
    );
}
