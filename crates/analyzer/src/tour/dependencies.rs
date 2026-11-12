//! What a repository of one project builds on: the dependencies its root
//! manifests declare for running, as its code imports them.

use model::{AnalysisResult, TourStep};

use super::{MAX_ROWS, code_files, count};
use crate::saturating_u32 as index;

/// A dependency is one the project builds on when this share of its code
/// files import it, in percent, at least: fastapi's `pydantic` (25%) is,
/// a helper two files of a hundred use is not.
const SHARE: u64 = 10;

/// The dependencies of the manifests at the root, outside any package and
/// not only for development, that a good share of the code imports, the
/// most imported first. A library's site declares its own dependencies in
/// its own manifest: they are not the library's.
pub(super) fn built_on(result: &AnalysisResult) -> Option<TourStep> {
    let externals = &result.externals;
    let code = code_files(result);
    let mut rows: Vec<usize> = (0..externals.name.len())
        .filter(|&row| {
            let manifest = externals.manifest[row] as usize;
            externals.package[row].is_none()
                && !externals.dev[row]
                && result.files.dir[manifest] == 0
                && u64::from(externals.files[row]) * 100 >= code * SHARE
        })
        .collect();
    rows.sort_by_key(|&row| (std::cmp::Reverse(externals.files[row]), row));
    rows.truncate(MAX_ROWS);
    (!rows.is_empty()).then(|| TourStep::BuiltOn {
        externals: rows.into_iter().map(index).collect(),
        code_files: count(code),
    })
}
