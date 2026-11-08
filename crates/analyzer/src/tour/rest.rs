//! The last step: what is not production code, and the parks of tests.

use model::{AnalysisResult, ParcelNature, Scope, TourStep};

use super::{MAX_ROWS, count};
use crate::saturating_u32 as index;

pub(super) fn rest(result: &AnalysisResult) -> Option<TourStep> {
    let files = &result.files;
    let (mut tests, mut examples, mut docs, mut config, mut root_config) = (0, 0, 0, 0, 0);
    for file in 0..files.dir.len() {
        if files.generated[file] {
            continue;
        }
        match files.scope[file] {
            Scope::Test | Scope::Fixture => tests += 1,
            Scope::Example => examples += 1,
            Scope::Docs => docs += 1,
            Scope::Config => {
                config += 1;
                root_config += u64::from(files.dir[file] == 0);
            }
            Scope::Source | Scope::Bench | Scope::Build => {}
        }
    }
    let (park_count, parks) = parks(result);
    if tests + examples + docs + config == 0 && park_count == 0 {
        return None;
    }
    Some(TourStep::Rest {
        tests: count(tests),
        examples: count(examples),
        docs: count(docs),
        config: count(config),
        root_config: count(root_config),
        park_count,
        parks,
    })
}

/// The folders shown as parks that are not inside another park, and the
/// ones with the most files.
fn parks(result: &AnalysisResult) -> (u32, Vec<u32>) {
    let dir_count = result.dirs.parent.len();
    let mut park = vec![false; dir_count];
    let layout = &result.layout;
    let natures = (layout.parcels.dir.iter().zip(&layout.parcels.nature))
        .chain(layout.grids.dir.iter().zip(&layout.grids.nature));
    for (&dir, &nature) in natures {
        park[dir as usize] |= nature == ParcelNature::Tests;
    }
    // Files below each folder: parents come first, so going backwards adds
    // each folder to its parent once it holds its whole subtree
    let mut below = vec![0u64; dir_count];
    for (file, &dir) in result.files.dir.iter().enumerate() {
        below[dir as usize] += u64::from(!result.files.generated[file]);
    }
    for dir in (1..dir_count).rev() {
        if let Some(parent) = result.dirs.parent[dir] {
            below[parent as usize] += below[dir];
        }
    }
    let mut inside = vec![false; dir_count];
    let mut outermost = Vec::new();
    for dir in 0..dir_count {
        if let Some(parent) = result.dirs.parent[dir] {
            inside[dir] = park[parent as usize] || inside[parent as usize];
        }
        if park[dir] && !inside[dir] {
            outermost.push(dir);
        }
    }
    let total = index(outermost.len());
    outermost.sort_by(|&a, &b| below[b].cmp(&below[a]).then(a.cmp(&b)));
    let shown = outermost.into_iter().take(MAX_ROWS).map(index).collect();
    (total, shown)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tour::fixture::Fixture;

    #[test]
    fn counts_what_is_not_code() {
        let mut repo = Fixture::layered();
        repo.file("examples/demo.ts", Scope::Example);
        repo.file("core/schema.json", Scope::Config);
        repo.file("test/data/a.json", Scope::Fixture);
        let generated = repo.test("test/b.test.ts");
        repo.result.files.generated[generated] = true;
        assert_eq!(
            rest(&repo.result),
            Some(TourStep::Rest {
                tests: 2,
                examples: 1,
                docs: 1,
                config: 2,
                root_config: 1,
                park_count: 0,
                parks: Vec::new(),
            })
        );
    }

    #[test]
    fn parks_inside_a_park_are_not_counted_and_the_largest_come_first() {
        let mut repo = Fixture::layered();
        repo.file("test/data/a.json", Scope::Fixture);
        for path in ["ui/tests/a.test.ts", "ui/tests/b.test.ts"] {
            repo.test(path);
        }
        for path in ["docs/tests/a.ts", "docs/tests/b.ts", "docs/tests/c.ts"] {
            repo.test(path);
        }
        let [test, data, ui, ui_tests, docs_tests] =
            ["test", "test/data", "ui", "ui/tests", "docs/tests"].map(|path| repo.dir(path));
        let layout = &mut repo.result.layout;
        layout.grids.dir = vec![test, ui];
        layout.grids.nature = vec![ParcelNature::Tests, ParcelNature::Normal];
        layout.parcels.dir = vec![data, ui_tests, docs_tests];
        layout.parcels.nature = vec![ParcelNature::Tests; 3];
        let Some(TourStep::Rest {
            park_count, parks, ..
        }) = rest(&repo.result)
        else {
            panic!("no rest step");
        };
        // `test` holds its test and the fixture of `test/data`: a tie with
        // `ui/tests`, which comes later
        assert_eq!(park_count, 3);
        assert_eq!(parks, [docs_tests, test, ui_tests]);
    }

    #[test]
    fn nothing_but_code_has_no_rest() {
        let mut repo = Fixture::new();
        repo.file("src/main.ts", Scope::Source);
        assert_eq!(rest(&repo.result), None);
    }
}
