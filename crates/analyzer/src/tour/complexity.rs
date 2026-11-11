//! The complex areas: the most complex files of the code, when they stand
//! out.

use model::{AnalysisResult, TourStep};

use super::monorepo::Monorepo;
use super::{MAX_ROWS, count, is_production};
use crate::saturating_u32 as index;

/// The most complex file must be this many times the median file.
const TIMES_MEDIAN: u64 = 3;
/// And at least this complex.
const MIN_COMPLEXITY: u32 = 20;

/// The most complex production files that other files import, one per
/// folder; in a monorepo, one per main unit of apps, or per package when
/// there is no app, so that each says where in the architecture it is. A
/// file nothing imports is often a copied library or a script: complex,
/// but not where the code's complexity lives. When the repository was too
/// large to count dependents, every production file is a candidate.
pub(super) fn complex_areas(
    result: &AnalysisResult,
    repo: Option<&Monorepo<'_>>,
) -> Option<TourStep> {
    let files = &result.files;
    let counted = files.dependents.iter().any(Option::is_some);
    let mut measured: Vec<u32> = Vec::new();
    let mut candidates: Vec<(u32, usize)> = Vec::new();
    for file in 0..files.dir.len() {
        let Some(complexity) = files.complexity[file] else {
            continue;
        };
        if !is_production(result, file) {
            continue;
        }
        measured.push(complexity);
        if !counted || files.dependents[file].is_some_and(|dependents| dependents > 0) {
            candidates.push((complexity, file));
        }
    }
    measured.sort_unstable();
    // The lower median: in a small repository, the large files would raise
    // the upper one
    let median = u64::from(*measured.get(measured.len().saturating_sub(1) / 2)?);
    // Each file shown stands out on its own
    candidates.retain(|&(complexity, _)| {
        complexity >= MIN_COMPLEXITY && u64::from(complexity) >= median * TIMES_MEDIAN
    });
    candidates.sort_unstable_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    let area = |file: usize| match repo {
        None => Some(files.dir[file]),
        Some(repo) => area_of(repo, file),
    };
    let mut areas = Vec::new();
    let mut shown = Vec::new();
    for &(_, file) in &candidates {
        if shown.len() == MAX_ROWS {
            break;
        }
        let Some(area) = area(file) else {
            continue;
        };
        if !areas.contains(&area) {
            areas.push(area);
            shown.push(index(file));
        }
    }
    (!shown.is_empty()).then(|| TourStep::ComplexAreas {
        files: shown,
        complexity: count(
            measured
                .iter()
                .map(|&complexity| u64::from(complexity))
                .sum(),
        ),
    })
}

/// The main unit of apps of a file, or its package when the monorepo has no
/// apps; `None` elsewhere.
fn area_of(repo: &Monorepo<'_>, file: usize) -> Option<u32> {
    let package = repo.package_of_file(file)?;
    if !repo.has_apps() {
        return Some(package);
    }
    let unit = repo
        .main()
        .iter()
        .position(|unit| unit.apps.contains(&package))?;
    Some(index(unit))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tour::fixture::Fixture;
    use model::Scope;

    #[test]
    fn files_that_stand_out_one_per_folder() {
        let mut repo = Fixture::layered();
        assert_eq!(complex_areas(&repo.result, None), None);
        let files = &mut repo.result.files;
        for (file, complexity) in [(0, 4), (1, 90), (2, 3), (3, 50), (4, 2), (5, 200)] {
            files.complexity[file] = Some(complexity);
        }
        // `app/main.ts`, the most complex, has no dependents; then one file
        // of `core` and one of `ui`
        assert_eq!(
            complex_areas(&repo.result, None),
            Some(TourStep::ComplexAreas {
                files: vec![1, 3],
                complexity: 349,
            })
        );
    }

    #[test]
    fn files_must_be_three_times_the_median_and_complex_enough() {
        let mut repo = Fixture::layered();
        repo.result.files.complexity[0] = Some(19);
        assert_eq!(complex_areas(&repo.result, None), None);
        repo.result.files.complexity[0] = Some(20);
        assert_eq!(
            complex_areas(&repo.result, None),
            Some(TourStep::ComplexAreas {
                files: vec![0],
                complexity: 25,
            })
        );
        for file in 1..6 {
            repo.result.files.complexity[file] = Some(7);
        }
        assert_eq!(complex_areas(&repo.result, None), None);
    }

    #[test]
    fn without_counted_dependents_every_file_is_a_candidate() {
        let mut repo = Fixture::layered();
        repo.result.files.complexity[5] = Some(200);
        assert_eq!(complex_areas(&repo.result, None), None);
        repo.result.files.dependents.fill(None);
        assert_eq!(
            complex_areas(&repo.result, None),
            Some(TourStep::ComplexAreas {
                files: vec![5],
                complexity: 205,
            })
        );
    }

    #[test]
    fn tests_and_unmeasured_files_are_left_out() {
        let mut repo = Fixture::layered();
        let test = repo.test("core/a.test.ts");
        repo.result.files.complexity[test] = Some(500);
        repo.result.files.complexity[0] = None;
        let css = repo.file("ui/theme.css", Scope::Source);
        repo.result.files.complexity[css] = None;
        assert_eq!(complex_areas(&repo.result, None), None);
    }

    #[test]
    fn in_a_monorepo_one_file_per_main_unit_of_apps() {
        let mut repo = Fixture::monorepo();
        for (path, complexity) in [
            ("apps/web/components/a.ts", 300),
            ("apps/web/components/b.ts", 200),
            ("apps/web/pages/index.ts", 250),
            ("apps/shop-b/index.ts", 90),
            ("apps/shop-a/index.ts", 80),
            // Not a main unit
            ("apps/admin/index.ts", 500),
            ("libs/log/index.ts", 400),
        ] {
            let file = repo.file_at(path);
            repo.result.files.complexity[file] = Some(complexity);
            repo.result.files.dependents[file] = Some(1);
        }
        let [a, shop_b] = ["apps/web/components/a.ts", "apps/shop-b/index.ts"]
            .map(|path| crate::saturating_u32(repo.file_at(path)));
        let monorepo = Monorepo::of(&repo.result);
        let Some(TourStep::ComplexAreas { files, .. }) =
            complex_areas(&repo.result, monorepo.as_ref())
        else {
            unreachable!()
        };
        assert_eq!(files, [a, shop_b]);
        // Without apps, one file per package
        repo.result.packages.kind[..6].fill(model::PackageKind::Library);
        let admin = crate::saturating_u32(repo.file_at("apps/admin/index.ts"));
        let log = crate::saturating_u32(repo.file_at("libs/log/index.ts"));
        let monorepo = Monorepo::of(&repo.result);
        let Some(TourStep::ComplexAreas { files, .. }) =
            complex_areas(&repo.result, monorepo.as_ref())
        else {
            unreachable!()
        };
        assert_eq!(files, [admin, log, a]);
    }
}
