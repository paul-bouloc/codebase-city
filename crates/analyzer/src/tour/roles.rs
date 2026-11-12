//! The steps read from the roles: entry points, conductors, foundations.

use model::{AnalysisResult, Ranked, TourStep};

use super::{MAX_ROWS, first_max, is_production};
use crate::saturating_u32 as index;

/// The first foundation must have this share of the production files as
/// dependents, at least.
const FOUNDATION_SHARE: u64 = 10;
/// And at least this many.
const FOUNDATION_MIN: u32 = 3;
/// The first conductor shown pulls together this share of the code files,
/// in percent, at least: below, it assembles a corner of the code, not the
/// code (fastapi's `security/http.py`, 11 files of 52; flask's `views.py`,
/// 21 of 24).
const CONDUCTOR_SHARE: u64 = 50;

/// A file, or for Go a package folder.
type Target = (Option<u32>, Option<u32>);

pub(super) fn entry_points(result: &AnalysisResult) -> Option<TourStep> {
    let count = result.roles.entries.file.len().min(MAX_ROWS);
    (count > 0).then(|| TourStep::EntryPoints {
        entries: (0..count).map(index).collect(),
    })
}

/// The conductors not already shown as an entry point (an application's
/// main file often is both), when the first pulls together half the code.
pub(super) fn conductors(
    result: &AnalysisResult,
    entry_points: Option<&TourStep>,
) -> Option<TourStep> {
    let entries = &result.roles.entries;
    let shown: Vec<Target> = match entry_points {
        Some(TourStep::EntryPoints { entries: rows }) => rows
            .iter()
            .map(|&row| (entries.file[row as usize], entries.dir[row as usize]))
            .collect(),
        _ => Vec::new(),
    };
    let ranked = &result.roles.conductors;
    let conductors: Vec<u32> = (0..ranked.file.len())
        .filter(|&row| !shown.contains(&target(ranked, row)))
        .take(MAX_ROWS)
        .map(index)
        .collect();
    let first = u64::from(ranked.count[*conductors.first()? as usize]);
    let files = &result.files;
    let code = (0..files.dir.len())
        .filter(|&file| is_production(result, file) && files.complexity[file].is_some())
        .count() as u64;
    (first * 100 >= code * CONDUCTOR_SHARE).then_some(TourStep::Conductors { conductors })
}

/// The first foundations, when the first one carries a good share of the
/// code, and the island most of them are in.
pub(super) fn foundations(result: &AnalysisResult) -> Option<TourStep> {
    let ranked = &result.roles.foundations;
    let first = *ranked.count.first()?;
    let production = (0..result.files.dir.len())
        .filter(|&file| is_production(result, file))
        .count() as u64;
    if first < FOUNDATION_MIN || u64::from(first) * 100 < production * FOUNDATION_SHARE {
        return None;
    }
    let foundations: Vec<u32> = (0..ranked.file.len().min(MAX_ROWS)).map(index).collect();
    let mut held = vec![0u64; result.islands.dir.len()];
    for &row in &foundations {
        let dir = match target(ranked, row as usize) {
            (Some(file), _) => Some(result.files.dir[file as usize]),
            (None, dir) => dir,
        };
        if let Some(island) = dir.and_then(|dir| result.dirs.island[dir as usize]) {
            held[island as usize] += 1;
        }
    }
    let island = first_max(held.iter().copied()).filter(|&island| held[island as usize] >= 2);
    Some(TourStep::Foundations {
        foundations,
        island,
    })
}

fn target(ranked: &Ranked, row: usize) -> Target {
    (ranked.file[row], ranked.dir[row])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tour::fixture::{Fixture, Role};
    use model::Scope;

    #[test]
    fn up_to_three_entry_points() {
        let mut repo = Fixture::layered();
        assert_eq!(
            entry_points(&repo.result),
            Some(TourStep::EntryPoints { entries: vec![0] })
        );
        for file in 0..4 {
            repo.entry(file);
        }
        assert_eq!(
            entry_points(&repo.result),
            Some(TourStep::EntryPoints {
                entries: vec![0, 1, 2]
            })
        );
        repo.result.roles.entries = model::Entries::default();
        assert_eq!(entry_points(&repo.result), None);
    }

    #[test]
    fn conductors_leave_out_the_entry_points_shown() {
        let mut repo = Fixture::layered();
        let shown = entry_points(&repo.result);
        // `app/main.ts` is both
        assert_eq!(conductors(&repo.result, shown.as_ref()), None);
        repo.ranked(Role::Conductor, &[(5, 5), (3, 3), (4, 2), (0, 1), (1, 1)]);
        assert_eq!(
            conductors(&repo.result, shown.as_ref()),
            Some(TourStep::Conductors {
                conductors: vec![1, 2, 3]
            })
        );
        assert_eq!(
            conductors(&repo.result, None),
            Some(TourStep::Conductors {
                conductors: vec![0, 1, 2]
            })
        );
    }

    #[test]
    fn the_first_conductor_shown_pulls_together_half_the_code() {
        // Six code files: `ui/view.ts` pulls together three, then two
        let mut repo = Fixture::layered();
        let shown = entry_points(&repo.result);
        repo.ranked(Role::Conductor, &[(5, 5), (3, 3)]);
        assert!(conductors(&repo.result, shown.as_ref()).is_some());
        repo.result.roles.conductors.count[1] = 2;
        assert_eq!(conductors(&repo.result, shown.as_ref()), None);
        // A test is no code: three of six still make half
        repo.result.roles.conductors.count[1] = 3;
        repo.test("ui/view.test.ts");
        assert!(conductors(&repo.result, shown.as_ref()).is_some());
    }

    /// [`Fixture::layered`] with Go packages as targets: `app` the entry
    /// point and first conductor, `core` then `core/net` the foundations.
    fn with_packages() -> Fixture {
        let mut repo = Fixture::layered();
        repo.file("core/net/conn.go", Scope::Source);
        let [app, core, net] = ["app", "core", "core/net"].map(|path| repo.dir(path));
        let roles = &mut repo.result.roles;
        roles.entries.file = vec![None];
        roles.entries.dir = vec![Some(app)];
        roles.conductors = Ranked {
            file: vec![None, Some(3)],
            dir: vec![Some(app), None],
            count: vec![5, 4],
        };
        roles.foundations = Ranked {
            file: vec![None, None],
            dir: vec![Some(core), Some(net)],
            count: vec![5, 4],
        };
        repo
    }

    #[test]
    fn a_package_shown_as_an_entry_point_is_not_a_conductor_again() {
        let repo = with_packages();
        let shown = entry_points(&repo.result);
        assert_eq!(
            conductors(&repo.result, shown.as_ref()),
            Some(TourStep::Conductors {
                conductors: vec![1]
            })
        );
    }

    #[test]
    fn package_foundations_are_placed_by_their_folders() {
        let mut repo = with_packages();
        let core = repo.island("core");
        assert_eq!(
            foundations(&repo.result),
            Some(TourStep::Foundations {
                foundations: vec![0, 1],
                island: Some(core),
            })
        );
    }

    #[test]
    fn foundations_need_a_share_of_the_code_and_two_in_an_island_to_name_it() {
        let mut repo = Fixture::layered();
        let core = repo.island("core");
        assert_eq!(
            foundations(&repo.result),
            Some(TourStep::Foundations {
                foundations: vec![0, 1],
                island: Some(core),
            })
        );
        // `core/a.ts` and `ui/view.ts`: one each
        repo.ranked(Role::Foundation, &[(0, 5), (3, 4)]);
        assert_eq!(
            foundations(&repo.result),
            Some(TourStep::Foundations {
                foundations: vec![0, 1],
                island: None,
            })
        );
        // Five dependents among 60 production files: less than a tenth
        for row in 0..54 {
            repo.file(&format!("lib/f{row}.ts"), Scope::Source);
        }
        assert_eq!(foundations(&repo.result), None);
        // Two dependents among six files: a third, but fewer than three
        let mut repo = Fixture::layered();
        repo.ranked(Role::Foundation, &[(0, 2)]);
        assert_eq!(foundations(&repo.result), None);
    }
}
