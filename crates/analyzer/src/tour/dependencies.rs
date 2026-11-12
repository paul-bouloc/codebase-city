//! What a repository of one project builds on: the dependencies its root
//! manifests declare for running, as its code imports them.

use model::{AnalysisResult, BUILT_ON_SHARE, TourStep};

use super::{MAX_ROWS, count};
use crate::saturating_u32 as index;

/// The dependencies of the manifests at the root, not only for
/// development, that a good share of the `code` files imports, the most
/// imported first. A library's site declares its own dependencies in its
/// own manifest: they are not the library's. The root may be a package of
/// its own (a uv project that is its workspace's member).
pub(super) fn built_on(result: &AnalysisResult, code: u64) -> Option<TourStep> {
    let externals = &result.externals;
    let mut rows: Vec<usize> = (0..externals.name.len())
        .filter(|&row| {
            let manifest = externals.manifest[row] as usize;
            !externals.dev[row]
                && result.files.dir[manifest] == 0
                && u64::from(externals.files[row]) * 100 >= code * BUILT_ON_SHARE
        })
        .collect();
    rows.sort_by_key(|&row| (std::cmp::Reverse(externals.files[row]), row));
    rows.truncate(MAX_ROWS);
    (!rows.is_empty()).then(|| TourStep::BuiltOn {
        externals: rows.into_iter().map(index).collect(),
        code_files: count(code),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use model::Externals;

    /// The sample of the format: `react` (row 1) in 2 of 14 code files,
    /// `axios` (row 0) in 1, both declared by `package.json` at the root.
    fn sample() -> AnalysisResult {
        let json = include_str!("../../../../web/src/data/generated/sample-result.json");
        serde_json::from_str(json).unwrap()
    }

    fn externals(step: Option<TourStep>) -> Vec<u32> {
        match step {
            Some(TourStep::BuiltOn { externals, .. }) => externals,
            _ => Vec::new(),
        }
    }

    #[test]
    fn dependencies_a_tenth_of_the_code_imports_from_the_root() {
        let result = sample();
        assert_eq!(externals(built_on(&result, 14)), [1]);
        assert_eq!(externals(built_on(&result, 10)), [1, 0]);
        assert_eq!(externals(built_on(&result, 21)), Vec::<u32>::new());
    }

    #[test]
    fn a_root_package_is_still_the_project() {
        // A uv project that is its workspace's member: every row is its
        // package's
        let mut result = sample();
        result.externals.package = vec![Some(0), Some(0)];
        assert_eq!(externals(built_on(&result, 14)), [1]);
        // Declared for development, or by a manifest below the root
        result.externals.dev[1] = true;
        assert_eq!(externals(built_on(&result, 14)), Vec::<u32>::new());
        let result = AnalysisResult {
            externals: Externals {
                manifest: vec![2, 2],
                ..sample().externals
            },
            ..sample()
        };
        assert_eq!(externals(built_on(&result, 14)), Vec::<u32>::new());
    }
}
