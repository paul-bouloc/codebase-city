//! How a repository of one project uses its own code: the examples that
//! import it, and the tests that import the examples.

use std::collections::{BTreeMap, HashSet};

use model::{AnalysisResult, MIN_EXAMPLES, Scope, TourStep};

use super::{MAX_ROWS, count, is_production};
use crate::saturating_u32 as index;

/// The folders at the top of the repository whose examples import
/// production code, the one with the most first, and the tests that import
/// an example (fastapi's tests run against the examples of its docs).
pub(super) fn examples_and_tests(result: &AnalysisResult) -> Option<TourStep> {
    let (files, edges, parents) = (&result.files, &result.edges, &result.dirs.parent);
    let production_dirs: HashSet<u32> = (0..files.dir.len())
        .filter(|&file| is_production(result, file))
        .map(|file| files.dir[file])
        .collect();
    let top = |mut dir: u32| -> Option<u32> {
        loop {
            match parents[dir as usize] {
                None => return None,
                Some(0) => return Some(dir),
                Some(parent) => dir = parent,
            }
        }
    };
    let mut importing: HashSet<usize> = HashSet::new();
    let mut tests: HashSet<usize> = HashSet::new();
    for edge in 0..edges.from.len() {
        let file = edges.from[edge] as usize;
        let to = edges.to[edge].map(|to| to as usize);
        match files.scope[file] {
            Scope::Example => {
                let imports_code = match to {
                    Some(to) => is_production(result, to),
                    None => edges.to_dir[edge].is_some_and(|dir| production_dirs.contains(&dir)),
                };
                if imports_code {
                    importing.insert(file);
                }
            }
            Scope::Test if to.is_some_and(|to| files.scope[to] == Scope::Example) => {
                tests.insert(file);
            }
            _ => {}
        }
    }
    let mut by_folder: BTreeMap<u32, u64> = BTreeMap::new();
    for &file in &importing {
        if let Some(folder) = top(files.dir[file]) {
            *by_folder.entry(folder).or_default() += 1;
        }
    }
    let mut folders: Vec<(u32, u64)> = by_folder.into_iter().collect();
    folders.sort_by_key(|&(folder, examples)| (std::cmp::Reverse(examples), folder));
    folders.truncate(MAX_ROWS);
    let shown: u64 = folders.iter().map(|&(_, examples)| examples).sum();
    (shown >= MIN_EXAMPLES).then(|| TourStep::ExamplesAndTests {
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
        repo.sort_edges();
        let Some(TourStep::ExamplesAndTests { examples, .. }) = examples_and_tests(&repo.result)
        else {
            unreachable!()
        };
        assert_eq!(examples, [10]);
    }
}
