//! The steps of a monorepo's apps: the main ones, the others, and inside
//! the largest.

use model::TourStep;

use super::monorepo::Monorepo;
use super::{MAX_ROWS, count, is_production};
use crate::saturating_u32 as index;

/// The largest app is looked inside when it holds this share of the apps'
/// code, in percent, at least: below, no app stands for the repository.
const INSIDE_SHARE: u64 = 40;
/// Fewer other apps make no list.
const MIN_OTHER_APPS: usize = 2;

pub(super) fn applications(repo: &Monorepo<'_>) -> Option<TourStep> {
    repo.has_apps().then(|| TourStep::Applications {
        units: repo.main().to_vec(),
        app_files: repo.app_files,
    })
}

/// The apps outside the main units, the largest first.
pub(super) fn other_apps(repo: &Monorepo<'_>) -> Option<TourStep> {
    let mut apps: Vec<u32> = repo.units[repo.main_units..]
        .iter()
        .flat_map(|unit| unit.apps.iter().copied())
        .collect();
    let files = &repo.result.packages.code_files;
    apps.sort_by_key(|&app| (std::cmp::Reverse(files[app as usize]), app));
    (apps.len() >= MIN_OTHER_APPS).then_some(TourStep::OtherApps { apps })
}

/// The largest folders of the app that holds a good share of the apps'
/// code, by their code files.
pub(super) fn inside_app(repo: &Monorepo<'_>) -> Option<TourStep> {
    let result = repo.result;
    let packages = &result.packages;
    let app = repo
        .units
        .iter()
        .flat_map(|unit| unit.apps.iter().copied())
        .max_by_key(|&app| (packages.code_files[app as usize], std::cmp::Reverse(app)))?;
    if u64::from(packages.code_files[app as usize]) * 100 < u64::from(repo.app_files) * INSIDE_SHARE
    {
        return None;
    }
    let root = packages.dir[app as usize];
    let parents = &result.dirs.parent;
    let mut code = vec![0u64; parents.len()];
    for file in 0..result.files.dir.len() {
        if is_production(result, file) && result.files.complexity[file].is_some() {
            code[result.files.dir[file] as usize] += 1;
        }
    }
    // Children come after their parent: going backwards adds each subtree
    for dir in (1..parents.len()).rev() {
        if let Some(parent) = parents[dir] {
            code[parent as usize] += code[dir];
        }
    }
    let mut children: Vec<(u64, u32)> = (0..parents.len())
        .filter(|&dir| parents[dir] == Some(root) && code[dir] > 0)
        .map(|dir| (code[dir], index(dir)))
        .collect();
    children.sort_by_key(|&(files, dir)| (std::cmp::Reverse(files), dir));
    children.truncate(MAX_ROWS);
    (!children.is_empty()).then(|| TourStep::InsideApp {
        app,
        dirs: children.iter().map(|&(_, dir)| dir).collect(),
        files: children.iter().map(|&(files, _)| count(files)).collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tour::fixture::Fixture;
    use model::{AppUnit, PackageKind};

    fn repo(fixture: &Fixture) -> Monorepo<'_> {
        Monorepo::of(&fixture.result).unwrap()
    }

    #[test]
    fn the_main_units_hold_three_percent_of_the_apps_code() {
        let mut fixture = Fixture::monorepo();
        assert_eq!(
            applications(&repo(&fixture)),
            Some(TourStep::Applications {
                units: vec![
                    AppUnit {
                        group: None,
                        apps: vec![0],
                        files: 100,
                    },
                    AppUnit {
                        group: Some(0),
                        apps: vec![1, 2],
                        files: 25,
                    },
                ],
                app_files: 129,
            })
        );
        // admin at 4 of 131 files: just above 3%
        fixture.result.packages.code_files[3] = 4;
        let Some(TourStep::Applications { units, .. }) = applications(&repo(&fixture)) else {
            unreachable!()
        };
        assert_eq!(units.len(), 3);
    }

    #[test]
    fn five_main_units_at_most_and_the_largest_always() {
        // Six apps outside any group, each well above 3%
        let mut fixture = Fixture::monorepo();
        fixture.result.packages.group.fill(None);
        fixture.result.packages.code_files[1..6].fill(30);
        let Some(TourStep::Applications { units, .. }) = applications(&repo(&fixture)) else {
            unreachable!()
        };
        let apps: Vec<&[u32]> = units.iter().map(|unit| unit.apps.as_slice()).collect();
        assert_eq!(apps, [[0], [1], [2], [3], [4]]);
        // One app holds nearly everything: it is still presented
        let mut fixture = Fixture::monorepo();
        fixture.result.packages.code_files[0] = 100_000;
        let Some(TourStep::Applications { units, .. }) = applications(&repo(&fixture)) else {
            unreachable!()
        };
        assert_eq!(units.len(), 1);
    }

    #[test]
    fn without_apps_there_is_no_applications_step() {
        let mut fixture = Fixture::monorepo();
        fixture.result.packages.kind[..6].fill(PackageKind::Library);
        assert_eq!(applications(&repo(&fixture)), None);
        assert_eq!(other_apps(&repo(&fixture)), None);
        assert_eq!(inside_app(&repo(&fixture)), None);
    }

    #[test]
    fn the_other_apps_are_two_or_more_the_largest_first() {
        let mut fixture = Fixture::monorepo();
        fixture.result.packages.code_files[5] = 2;
        assert_eq!(
            other_apps(&repo(&fixture)),
            Some(TourStep::OtherApps {
                apps: vec![3, 5, 4]
            })
        );
        // admin and kiosk become main ones: tools stays alone
        fixture.result.packages.code_files[3] = 50;
        fixture.result.packages.code_files[5] = 50;
        assert_eq!(other_apps(&repo(&fixture)), None);
    }

    #[test]
    fn inside_the_app_that_holds_forty_percent_of_the_apps_code() {
        let mut fixture = Fixture::monorepo();
        let components = fixture.dir("apps/web/components");
        let pages = fixture.dir("apps/web/pages");
        assert_eq!(
            inside_app(&repo(&fixture)),
            Some(TourStep::InsideApp {
                app: 0,
                dirs: vec![components, pages],
                files: vec![2, 1],
            })
        );
        // 100 files of 251: below 40%
        fixture.result.packages.code_files[1] = 122;
        assert_eq!(inside_app(&repo(&fixture)), None);
    }
}
