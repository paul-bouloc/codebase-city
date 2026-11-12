//! How a repository of one project uses its own code: the examples that
//! import it, and the tests that import the examples.

use std::collections::{BTreeMap, HashSet};

use model::{AnalysisResult, MIN_EXAMPLES, Scope, TourStep};

use super::{MAX_ROWS, count, is_production};
use crate::saturating_u32 as index;

/// The folders whose examples import production code, the one with the
/// most first, and the tests that import one of their examples (fastapi's
/// tests run against the examples of its docs). The folder of an example
/// is the highest one above it that holds no production code: `docs_src/`,
/// or `src/examples/` beside the code, never the code's own folder.
pub(super) fn examples_and_tests(result: &AnalysisResult) -> Option<TourStep> {
    let (files, edges, parents) = (&result.files, &result.edges, &result.dirs.parent);
    let is_code = |file: usize| is_production(result, file) && files.complexity[file].is_some();
    // Folders holding code of their own, and holding it below them
    let mut code_dirs: HashSet<u32> = HashSet::new();
    let mut code_below = vec![false; parents.len()];
    for file in (0..files.dir.len()).filter(|&file| is_code(file)) {
        code_dirs.insert(files.dir[file]);
        code_below[files.dir[file] as usize] = true;
    }
    // Children come after their parent: going backwards marks each subtree
    for dir in (1..parents.len()).rev() {
        if let Some(parent) = parents[dir]
            && code_below[dir]
        {
            code_below[parent as usize] = true;
        }
    }
    let folder_of = |dir: u32| -> Option<u32> {
        let mut folder = dir;
        while let Some(parent) = parents[folder as usize]
            && parent != 0
            && !code_below[parent as usize]
        {
            folder = parent;
        }
        (folder != 0).then_some(folder)
    };
    let imports_code = |edge: usize| match edges.to[edge] {
        Some(to) => is_code(to as usize),
        None => edges.to_dir[edge].is_some_and(|dir| code_dirs.contains(&dir)),
    };
    let mut examples: BTreeMap<u32, u64> = BTreeMap::new();
    let mut counted: HashSet<usize> = HashSet::new();
    for edge in 0..edges.from.len() {
        let file = edges.from[edge] as usize;
        if files.scope[file] == Scope::Example
            && imports_code(edge)
            && counted.insert(file)
            && let Some(folder) = folder_of(files.dir[file])
        {
            *examples.entry(folder).or_default() += 1;
        }
    }
    let mut folders: Vec<(u32, u64)> = examples.into_iter().collect();
    folders.sort_by_key(|&(folder, examples)| (std::cmp::Reverse(examples), folder));
    folders.truncate(MAX_ROWS);
    let shown: u64 = folders.iter().map(|&(_, examples)| examples).sum();
    if shown < MIN_EXAMPLES {
        return None;
    }
    // The tests of the examples shown: by file, or by package folder in Go
    let shown_folders: HashSet<u32> = folders.iter().map(|&(folder, _)| folder).collect();
    let in_shown = |dir: u32| folder_of(dir).is_some_and(|folder| shown_folders.contains(&folder));
    let example_dirs: HashSet<u32> = counted.iter().map(|&example| files.dir[example]).collect();
    let mut tests: HashSet<usize> = HashSet::new();
    for edge in 0..edges.from.len() {
        let file = edges.from[edge] as usize;
        if files.scope[file] != Scope::Test {
            continue;
        }
        let example = match edges.to[edge] {
            Some(to) => {
                let to = to as usize;
                files.scope[to] == Scope::Example && in_shown(files.dir[to])
            }
            None => {
                edges.to_dir[edge].is_some_and(|dir| in_shown(dir) && example_dirs.contains(&dir))
            }
        };
        if example {
            tests.insert(file);
        }
    }
    Some(TourStep::ExamplesAndTests {
        folders: folders.iter().map(|&(folder, _)| folder).collect(),
        examples: folders
            .iter()
            .map(|&(_, examples)| count(examples))
            .collect(),
        tests: index(tests.len()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tour::fixture::Fixture;
    use model::EdgeKind;

    /// `count` examples in `folder`, each importing `core/a.ts`.
    fn examples(repo: &mut Fixture, folder: &str, count: usize) -> Vec<usize> {
        (0..count)
            .map(|row| {
                let file = repo.file(&format!("{folder}/ex{row}.ts"), Scope::Example);
                repo.import(file, 0, EdgeKind::Import);
                file
            })
            .collect()
    }

    #[test]
    fn ten_examples_that_import_the_code_make_a_step() {
        let mut repo = Fixture::layered();
        let docs = examples(&mut repo, "docs_src/tutorial", 9);
        repo.sort_edges();
        assert_eq!(examples_and_tests(&repo.result), None);
        // An example that imports another example is not one more
        let other = repo.file("docs_src/other.ts", Scope::Example);
        repo.import(other, docs[0], EdgeKind::Import);
        repo.sort_edges();
        assert_eq!(examples_and_tests(&repo.result), None);
        examples(&mut repo, "examples", 3);
        // A test that imports two examples counts once
        let test = repo.test("test/run.test.ts");
        repo.import(test, docs[0], EdgeKind::Import);
        repo.import(test, docs[1], EdgeKind::Import);
        repo.sort_edges();
        let [docs_src, examples_dir] = ["docs_src", "examples"].map(|path| repo.dir(path));
        assert_eq!(
            examples_and_tests(&repo.result),
            Some(TourStep::ExamplesAndTests {
                folders: vec![docs_src, examples_dir],
                examples: vec![9, 3],
                tests: 1,
            })
        );
    }

    #[test]
    fn examples_import_code_and_lie_in_the_highest_folder_without_any() {
        let mut repo = Fixture::layered();
        // Ten examples beside the code, in `core/examples`, and one that
        // imports a stylesheet only
        let examples = examples(&mut repo, "core/examples", 10);
        let css = repo.file("core/theme.css", Scope::Source);
        repo.result.files.complexity[css] = None;
        let styled = repo.file("docs/styled.ts", Scope::Example);
        repo.import(styled, css, EdgeKind::Import);
        // A test of an example of `core/examples`, one of the stylesheet's
        let test = repo.test("test/core.test.ts");
        repo.import(test, examples[0], EdgeKind::Import);
        let other = repo.test("test/styled.test.ts");
        repo.import(other, styled, EdgeKind::Import);
        repo.sort_edges();
        let folder = repo.dir("core/examples");
        assert_eq!(
            examples_and_tests(&repo.result),
            Some(TourStep::ExamplesAndTests {
                folders: vec![folder],
                examples: vec![10],
                tests: 1,
            })
        );
    }

    #[test]
    fn examples_that_import_a_package_folder_count() {
        // A Go example imports its package by folder
        let mut repo = Fixture::layered();
        let core = repo.dir("core");
        for row in 0..10 {
            let file = repo.file(&format!("examples/ex{row}.go"), Scope::Example);
            let edges = &mut repo.result.edges;
            edges.from.push(index(file));
            edges.to.push(None);
            edges.to_dir.push(Some(core));
            edges.kind.push(EdgeKind::Import);
            edges.confidence.push(model::Confidence::Exact);
        }
        // A Go test imports the examples' package by folder too
        let test = repo.test("examples/run_test.go");
        let examples_dir = repo.dir("examples");
        let edges = &mut repo.result.edges;
        edges.from.push(index(test));
        edges.to.push(None);
        edges.to_dir.push(Some(examples_dir));
        edges.kind.push(EdgeKind::Import);
        edges.confidence.push(model::Confidence::Exact);
        repo.sort_edges();
        let Some(TourStep::ExamplesAndTests {
            examples, tests, ..
        }) = examples_and_tests(&repo.result)
        else {
            unreachable!()
        };
        assert_eq!((examples, tests), (vec![10], 1));
    }
}
