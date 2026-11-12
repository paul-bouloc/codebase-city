//! Checks on the tour of a result: the order of its steps and what they
//! point at.

use super::{InvalidResult, in_bounds};
use crate::result::{AnalysisResult, PackageKind, TourStep};

/// The most rows a list of files or roles holds.
const MAX_ROWS: usize = 3;
/// The most units of apps the applications step holds.
const MAX_UNITS: usize = 5;
/// The most libraries the libraries step ranks.
const MAX_MOST_IMPORTED: usize = 4;
/// A dependency the project builds on is imported by this share of its
/// code files, in percent, at least.
const BUILT_ON_SHARE: u64 = 10;
/// Fewer examples that import the code make no step.
const MIN_EXAMPLES: u64 = 10;

/// The place of a kind of step in the tour.
fn rank(step: &TourStep) -> u8 {
    match step {
        TourStep::Overview { .. } => 0,
        TourStep::BuiltOn { .. } => 1,
        TourStep::EntryPoints { .. } => 2,
        TourStep::Conductors { .. } => 3,
        TourStep::Foundations { .. } => 4,
        TourStep::Applications { .. } => 5,
        TourStep::OtherApps { .. } => 6,
        TourStep::Libraries { .. } => 7,
        TourStep::AppLinks { .. } => 8,
        TourStep::Layers { .. } => 9,
        TourStep::ExamplesAndTests { .. } => 10,
        TourStep::Consumers { .. } => 11,
        TourStep::InsidePackage { .. } => 12,
        TourStep::Cycles { .. } => 13,
        TourStep::ComplexAreas { .. } => 14,
        TourStep::Rest { .. } => 15,
    }
}

/// Which tour a kind of step belongs to, when only one has it.
#[derive(PartialEq)]
enum Tour {
    Files,
    Packages,
}

fn tour_of(step: &TourStep) -> Option<Tour> {
    match step {
        TourStep::BuiltOn { .. }
        | TourStep::ExamplesAndTests { .. }
        | TourStep::EntryPoints { .. }
        | TourStep::Conductors { .. }
        | TourStep::Foundations { .. } => Some(Tour::Files),
        TourStep::Applications { .. }
        | TourStep::OtherApps { .. }
        | TourStep::Libraries { .. }
        | TourStep::AppLinks { .. }
        | TourStep::Consumers { .. }
        | TourStep::InsidePackage { .. } => Some(Tour::Packages),
        TourStep::Overview { .. }
        | TourStep::Layers { .. }
        | TourStep::Cycles { .. }
        | TourStep::ComplexAreas { .. }
        | TourStep::Rest { .. } => None,
    }
}

pub(super) fn tour(result: &AnalysisResult) -> Result<(), InvalidResult> {
    let steps = &result.tour.steps;
    if !matches!(steps.first(), Some(TourStep::Overview { .. })) {
        return Err(InvalidResult::TourStart);
    }
    if let Some(row) = steps
        .windows(2)
        .position(|pair| rank(&pair[0]) >= rank(&pair[1]))
    {
        return Err(InvalidResult::TourOrder { row: row + 1 });
    }
    let mut first = None;
    for (row, step) in steps.iter().enumerate() {
        let Some(tour) = tour_of(step) else {
            continue;
        };
        match &first {
            None => first = Some(tour),
            Some(first) if *first != tour => return Err(InvalidResult::TourMixed { row }),
            Some(_) => {}
        }
    }
    // A tour of packages presents the main apps exactly when they lead
    let apps_lead = result.packages.apps_lead();
    let presents_apps = steps
        .iter()
        .any(|step| matches!(step, TourStep::Applications { .. }));
    if first == Some(Tour::Packages) && presents_apps != apps_lead {
        return Err(InvalidResult::TourAppsLead);
    }
    for (row, step) in steps.iter().enumerate() {
        check_step(result, row, step, apps_lead)?;
    }
    Ok(())
}

#[expect(
    clippy::too_many_lines,
    reason = "one arm per kind of step, each short"
)]
fn check_step(
    result: &AnalysisResult,
    row: usize,
    step: &TourStep,
    apps_lead: bool,
) -> Result<(), InvalidResult> {
    let file_count = result.files.dir.len();
    let dir_count = result.dirs.parent.len();
    let island_count = result.islands.dir.len();
    let package_count = result.packages.dir.len();
    let list = |column, rows: &[u32], len| {
        listed(row, rows, 1, MAX_ROWS)?;
        in_bounds(column, rows, len)
    };
    let optional = |column, index: Option<u32>, len| in_bounds(column, index.as_slice(), len);
    let required = |column, index: u32, len| in_bounds(column, &[index], len);
    // Packages of the kind the step says, each once
    let packages = |column, rows: &[u32], kind, min, max| {
        listed(row, rows, min, max)?;
        in_bounds(column, rows, package_count)?;
        if rows
            .iter()
            .all(|&at| result.packages.kind[at as usize] == kind)
        {
            Ok(())
        } else {
            Err(InvalidResult::TourPackageKind { row })
        }
    };
    let count = |holds: bool| {
        if holds {
            Ok(())
        } else {
            Err(InvalidResult::TourCount { row })
        }
    };
    match step {
        TourStep::Overview {
            lines,
            language,
            language_lines,
            language_read,
            biggest_island,
            outside_island,
            doc_languages,
            ..
        } => {
            optional("tour.language", *language, result.languages.len())?;
            optional("tour.biggestIsland", *biggest_island, island_count)?;
            optional("tour.outsideIsland", *outside_island, island_count)?;
            let without = language.is_none() && (*language_lines > 0 || *language_read);
            count(language_lines <= lines && !without && *doc_languages != 1)?;
        }
        TourStep::BuiltOn {
            externals,
            code_files,
        } => {
            let table = &result.externals;
            list("tour.externals", externals, table.name.len())?;
            // Declared at the root for running, outside any package, by a
            // good share of the code, the most imported first
            let mut previous = u32::MAX;
            for &at in externals {
                let at = at as usize;
                let manifest = table.manifest[at] as usize;
                let files = table.files[at];
                count(
                    table.package[at].is_none()
                        && !table.dev[at]
                        && result.files.dir[manifest] == 0
                        && files <= previous
                        && files <= *code_files
                        && u64::from(files) * 100 >= u64::from(*code_files) * BUILT_ON_SHARE,
                )?;
                previous = files;
            }
        }
        TourStep::EntryPoints { entries } => {
            list("tour.entries", entries, result.roles.entries.file.len())?;
        }
        TourStep::ExamplesAndTests {
            folders,
            examples,
            tests,
        } => {
            list("tour.folders", folders, dir_count)?;
            // At the top of the repository, the most examples first
            let at_top = folders
                .iter()
                .all(|&dir| result.dirs.parent[dir as usize] == Some(0));
            let sorted = examples.windows(2).all(|pair| pair[0] >= pair[1]);
            let all: u64 = examples.iter().copied().map(u64::from).sum();
            let test_files = result
                .files
                .scope
                .iter()
                .filter(|&&scope| scope == crate::result::Scope::Test)
                .count();
            count(
                examples.len() == folders.len()
                    && !examples.contains(&0)
                    && at_top
                    && sorted
                    && all >= MIN_EXAMPLES
                    && *tests as usize <= test_files,
            )?;
        }
        TourStep::Conductors { conductors } => {
            list(
                "tour.conductors",
                conductors,
                result.roles.conductors.file.len(),
            )?;
        }
        TourStep::Foundations {
            foundations,
            island,
        } => {
            list(
                "tour.foundations",
                foundations,
                result.roles.foundations.file.len(),
            )?;
            optional("tour.island", *island, island_count)?;
        }
        TourStep::Applications { units, app_files } => {
            if !(1..=MAX_UNITS).contains(&units.len()) {
                return Err(InvalidResult::TourList { row });
            }
            let mut apps = Vec::new();
            for unit in units {
                optional("tour.group", unit.group, result.package_groups.prefix.len())?;
                apps.extend_from_slice(&unit.apps);
            }
            packages("tour.apps", &apps, PackageKind::App, 1, usize::MAX)?;
            if units.iter().any(|unit| unit.apps.is_empty()) {
                return Err(InvalidResult::TourList { row });
            }
            let files: u64 = units.iter().map(|unit| u64::from(unit.files)).sum();
            let largest_first = units.windows(2).all(|pair| pair[0].files >= pair[1].files);
            count(files <= u64::from(*app_files) && largest_first)?;
        }
        TourStep::OtherApps { apps } => {
            // After the main apps, one more makes no list; in a monorepo of
            // libraries, its only app is worth naming
            let min = if apps_lead { 2 } else { 1 };
            packages("tour.apps", apps, PackageKind::App, min, usize::MAX)?;
        }
        TourStep::Libraries {
            most_imported,
            importers,
            largest,
            single_app,
            unused,
        } => {
            let library = PackageKind::Library;
            packages(
                "tour.mostImported",
                most_imported,
                library,
                1,
                MAX_MOST_IMPORTED,
            )?;
            packages("tour.largest", &[*largest], library, 1, 1)?;
            packages("tour.singleApp", single_app, library, 0, usize::MAX)?;
            packages("tour.unused", unused, library, 0, usize::MAX)?;
            let most_first = importers.windows(2).all(|pair| pair[0] >= pair[1]);
            count(importers.len() == most_imported.len() && most_first)?;
        }
        TourStep::AppLinks { shared, .. } => {
            if !(1..=MAX_ROWS).contains(&shared.len()) {
                return Err(InvalidResult::TourList { row });
            }
            let libraries: Vec<u32> = shared.iter().map(|shared| shared.library).collect();
            packages(
                "tour.library",
                &libraries,
                PackageKind::Library,
                1,
                MAX_ROWS,
            )?;
            for shared in shared {
                packages("tour.apps", &shared.apps, PackageKind::App, 2, usize::MAX)?;
                count(shared.type_only <= shared.files)?;
            }
        }
        TourStep::Layers { worst_link, .. } => {
            optional("tour.worstLink", *worst_link, result.links.from.len())?;
        }
        TourStep::Consumers { folders, package } => {
            if !(1..=MAX_ROWS).contains(&folders.len()) {
                return Err(InvalidResult::TourList { row });
            }
            let dirs: Vec<u32> = folders.iter().map(|folder| folder.dir).collect();
            list("tour.dir", &dirs, dir_count)?;
            required("tour.package", *package, package_count)?;
        }
        TourStep::InsidePackage {
            package,
            dirs,
            files,
        } => {
            // The main app when apps lead, the main library otherwise
            let kind = if apps_lead {
                PackageKind::App
            } else {
                PackageKind::Library
            };
            packages("tour.package", &[*package], kind, 1, 1)?;
            list("tour.dirs", dirs, dir_count)?;
            count(files.len() == dirs.len())?;
        }
        TourStep::Cycles {
            cycle,
            dir,
            package,
            in_package,
            crossing,
        } => {
            required("tour.cycle", *cycle, result.cycles.members.len())?;
            required("tour.dir", *dir, dir_count)?;
            optional("tour.package", *package, package_count)?;
            let cycles = result.cycles.members.len();
            let inside = if package.is_some() {
                (1..=cycles).contains(&(*in_package as usize))
            } else {
                *in_package == 0
            };
            count(inside && (*in_package as usize) + (*crossing as usize) <= cycles)?;
        }
        TourStep::ComplexAreas { files, .. } => {
            list("tour.files", files, file_count)?;
        }
        TourStep::Rest {
            tests,
            park_count,
            park_tests,
            parks,
            ..
        } => {
            listed(row, parks, 0, MAX_ROWS)?;
            in_bounds("tour.parks", parks, dir_count)?;
            count(parks.len() <= *park_count as usize && park_tests <= tests)?;
        }
    }
    Ok(())
}

/// A list of `min` to `max` rows, each once.
fn listed(row: usize, rows: &[u32], min: usize, max: usize) -> Result<(), InvalidResult> {
    // The length first: checking each row against the others is quadratic
    if !(min..=max).contains(&rows.len()) {
        return Err(InvalidResult::TourList { row });
    }
    let mut sorted = rows.to_vec();
    sorted.sort_unstable();
    if sorted.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(InvalidResult::TourList { row });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::result::{AppUnit, Packages, Workspace, WorkspaceKind};
    use crate::validate::tests::{invalid, result};

    /// The sample as a monorepo of one app, `src/`, with a tour of
    /// packages: its applications, then inside the app.
    fn monorepo(r: &mut AnalysisResult) {
        r.workspaces = vec![Workspace {
            kind: WorkspaceKind::Npm,
            manifest: 0,
        }];
        r.packages = Packages {
            dir: vec![1],
            name: vec!["app".to_owned()],
            kind: vec![PackageKind::App],
            framework: vec![None],
            manifest: vec![None],
            group: vec![None],
            code_files: vec![2],
            entry: vec![None],
            routes: vec![None],
            route_count: vec![0],
            api_route_count: vec![0],
        };
        r.tour.steps.splice(
            1..4,
            [TourStep::Applications {
                units: vec![AppUnit {
                    group: None,
                    apps: vec![0],
                    files: 2,
                }],
                app_files: 2,
            }],
        );
        r.tour.steps.insert(
            3,
            TourStep::InsidePackage {
                package: 0,
                dirs: vec![1],
                files: vec![2],
            },
        );
    }

    /// Why the monorepo's tour is invalid after a change.
    fn invalid_monorepo(change: impl FnOnce(&mut AnalysisResult)) -> InvalidResult {
        invalid(|r| {
            monorepo(r);
            change(r);
        })
    }

    fn step(r: &mut AnalysisResult, kind: u8) -> &mut TourStep {
        r.tour
            .steps
            .iter_mut()
            .find(|step| rank(step) == kind)
            .unwrap()
    }

    #[test]
    fn the_tour_starts_with_the_overview() {
        assert_eq!(
            invalid(|r| {
                r.tour.steps.remove(0);
            }),
            InvalidResult::TourStart
        );
        assert_eq!(invalid(|r| r.tour.steps.clear()), InvalidResult::TourStart);
    }

    #[test]
    fn steps_come_once_each_in_order() {
        assert_eq!(
            invalid(|r| r.tour.steps.swap(1, 2)),
            InvalidResult::TourOrder { row: 2 }
        );
        assert_eq!(
            invalid(|r| {
                let again = r.tour.steps[1].clone();
                r.tour.steps.insert(1, again);
            }),
            InvalidResult::TourOrder { row: 2 }
        );
    }

    #[test]
    fn lists_hold_one_to_three_rows_each_once() {
        assert_eq!(
            invalid(|r| {
                if let TourStep::EntryPoints { entries } = step(r, 2) {
                    entries.clear();
                }
            }),
            InvalidResult::TourList { row: 1 }
        );
        assert_eq!(
            invalid(|r| {
                if let TourStep::ComplexAreas { files, .. } = step(r, 14) {
                    *files = vec![0, 1, 0];
                }
            }),
            InvalidResult::TourList { row: 6 }
        );
        assert_eq!(
            invalid(|r| {
                if let TourStep::Rest { parks, .. } = step(r, 15) {
                    *parks = vec![0, 1, 0, 1];
                }
            }),
            InvalidResult::TourList { row: 7 }
        );
    }

    #[test]
    fn steps_point_inside_their_tables() {
        assert_eq!(
            invalid(|r| {
                if let TourStep::Conductors { conductors } = step(r, 3) {
                    conductors[0] = 1;
                }
            }),
            InvalidResult::IndexOutOfBounds {
                column: "tour.conductors",
                row: 0,
                index: 1,
                len: 1,
            }
        );
        assert_eq!(
            invalid(|r| {
                if let TourStep::Overview { outside_island, .. } = step(r, 0) {
                    *outside_island = Some(2);
                }
            }),
            InvalidResult::IndexOutOfBounds {
                column: "tour.outsideIsland",
                row: 0,
                index: 2,
                len: 2,
            }
        );
        assert_eq!(
            invalid(|r| {
                if let TourStep::Layers { worst_link, .. } = step(r, 9) {
                    *worst_link = Some(1);
                }
            }),
            InvalidResult::IndexOutOfBounds {
                column: "tour.worstLink",
                row: 0,
                index: 1,
                len: 1,
            }
        );
        assert_eq!(
            invalid(|r| {
                if let TourStep::Cycles { dir, .. } = step(r, 13) {
                    *dir = 2;
                }
            }),
            InvalidResult::IndexOutOfBounds {
                column: "tour.dir",
                row: 0,
                index: 2,
                len: 2,
            }
        );
    }

    #[test]
    fn counts_hold_together() {
        // One language is no languages
        assert_eq!(
            invalid(|r| {
                if let TourStep::Overview { doc_languages, .. } = step(r, 0) {
                    *doc_languages = 1;
                }
            }),
            InvalidResult::TourCount { row: 0 }
        );
        assert_eq!(
            invalid(|r| {
                if let TourStep::Overview { language_lines, .. } = step(r, 0) {
                    *language_lines = 53;
                }
            }),
            InvalidResult::TourCount { row: 0 }
        );
        assert_eq!(
            invalid(|r| {
                if let TourStep::Rest { park_count, .. } = step(r, 15) {
                    *park_count = 0;
                }
            }),
            InvalidResult::TourCount { row: 7 }
        );
        assert_eq!(
            invalid(|r| {
                if let TourStep::Rest { park_tests, .. } = step(r, 15) {
                    *park_tests = 1;
                }
            }),
            InvalidResult::TourCount { row: 7 }
        );
    }

    #[test]
    fn a_tour_of_the_overview_alone_is_valid() {
        let mut r = result();
        r.tour.steps.truncate(1);
        assert_eq!(r.validate(), Ok(()));
    }

    #[test]
    fn a_tour_of_packages_is_valid() {
        let mut r = result();
        monorepo(&mut r);
        assert_eq!(r.validate(), Ok(()));
    }

    #[test]
    fn a_tour_never_mixes_packages_and_files() {
        assert_eq!(
            invalid(|r| {
                r.tour
                    .steps
                    .insert(4, TourStep::OtherApps { apps: vec![0, 1] });
            }),
            InvalidResult::TourMixed { row: 4 }
        );
    }

    #[test]
    fn packages_are_of_the_kind_their_step_says() {
        assert_eq!(
            invalid_monorepo(|r| {
                r.tour.steps.insert(
                    2,
                    TourStep::Libraries {
                        most_imported: vec![0],
                        importers: vec![1],
                        largest: 0,
                        single_app: Vec::new(),
                        unused: Vec::new(),
                    },
                );
            }),
            InvalidResult::TourPackageKind { row: 2 }
        );
        // Without apps, nothing leads: no main apps to present
        assert_eq!(
            invalid_monorepo(|r| {
                r.packages.kind[0] = PackageKind::Library;
            }),
            InvalidResult::TourAppsLead
        );
    }

    /// Adds `lib` at the root, a library of `files` code files around the
    /// app, which becomes package 1.
    fn library(r: &mut AnalysisResult, files: u32) {
        let packages = &mut r.packages;
        packages.dir.insert(0, 0);
        packages.name.insert(0, "lib".to_owned());
        packages.kind.insert(0, PackageKind::Library);
        packages.framework.insert(0, None);
        packages.manifest.insert(0, None);
        packages.group.insert(0, None);
        packages.code_files.insert(0, files);
        packages.entry.insert(0, None);
        packages.routes.insert(0, None);
        packages.route_count.insert(0, 0);
        packages.api_route_count.insert(0, 0);
        for step in &mut r.tour.steps {
            match step {
                TourStep::Applications { units, .. } => units[0].apps = vec![1],
                TourStep::InsidePackage { package, .. } => *package = 1,
                _ => {}
            }
        }
    }

    #[test]
    fn main_apps_are_presented_when_apps_hold_ten_percent_of_the_code() {
        // The app holds 2 code files of 20: it still leads
        let mut r = result();
        monorepo(&mut r);
        library(&mut r, 18);
        assert_eq!(r.validate(), Ok(()));
        // 2 of 21: a monorepo of libraries, whose tour has no main apps
        r.packages.code_files[0] = 19;
        assert_eq!(r.validate(), Err(InvalidResult::TourAppsLead));
    }

    #[test]
    fn lists_of_packages_hold_what_their_step_says() {
        assert_eq!(
            invalid_monorepo(|r| {
                r.tour
                    .steps
                    .insert(2, TourStep::OtherApps { apps: vec![0] });
            }),
            InvalidResult::TourList { row: 2 }
        );
        assert_eq!(
            invalid_monorepo(|r| {
                if let TourStep::Applications { units, .. } = &mut r.tour.steps[1] {
                    units[0].apps.push(0);
                }
            }),
            InvalidResult::TourList { row: 1 }
        );
        assert_eq!(
            invalid_monorepo(|r| {
                if let TourStep::Applications { units, .. } = &mut r.tour.steps[1] {
                    units.clear();
                }
            }),
            InvalidResult::TourList { row: 1 }
        );
        assert_eq!(
            invalid_monorepo(|r| {
                if let TourStep::InsidePackage { dirs, .. } = &mut r.tour.steps[3] {
                    dirs[0] = 2;
                }
            }),
            InvalidResult::IndexOutOfBounds {
                column: "tour.dirs",
                row: 0,
                index: 2,
                len: 2,
            }
        );
    }

    #[test]
    fn one_other_app_is_named_only_without_main_apps() {
        assert_eq!(
            invalid_monorepo(|r| {
                r.tour
                    .steps
                    .insert(2, TourStep::OtherApps { apps: vec![0] });
            }),
            InvalidResult::TourList { row: 2 }
        );
        // A monorepo of libraries: its only app is named, and the inside
        // step looks inside a library
        let mut r = result();
        monorepo(&mut r);
        library(&mut r, 100);
        r.tour.steps[1] = TourStep::OtherApps { apps: vec![1] };
        assert_eq!(r.validate(), Err(InvalidResult::TourPackageKind { row: 3 }));
        if let TourStep::InsidePackage { package, .. } = &mut r.tour.steps[3] {
            *package = 0;
        }
        assert_eq!(r.validate(), Ok(()));
    }

    #[test]
    fn inside_a_library_of_a_monorepo_of_libraries() {
        let mut r = result();
        monorepo(&mut r);
        r.packages.kind[0] = PackageKind::Library;
        r.tour.steps.remove(1);
        assert_eq!(r.validate(), Ok(()));
        if let TourStep::InsidePackage { package, .. } = &mut r.tour.steps[2] {
            *package = 1;
        }
        assert_eq!(
            r.validate(),
            Err(InvalidResult::IndexOutOfBounds {
                column: "tour.package",
                row: 0,
                index: 1,
                len: 1,
            })
        );
    }

    #[test]
    fn examples_and_tests_count_ten_examples_in_top_folders() {
        // After the layers, before the cycles: `src` holds ten examples
        let with = |examples: Vec<u32>, tests: u32| {
            move |r: &mut AnalysisResult| {
                r.tour.steps.insert(
                    5,
                    TourStep::ExamplesAndTests {
                        folders: vec![1],
                        examples,
                        tests,
                    },
                );
            }
        };
        let mut r = result();
        with(vec![10], 0)(&mut r);
        assert_eq!(r.validate(), Ok(()));
        for change in [with(vec![9], 0), with(vec![10, 2], 0), with(vec![10], 1)] {
            assert_eq!(invalid(change), InvalidResult::TourCount { row: 5 });
        }
        // The root is no folder at the top
        assert_eq!(
            invalid(|r| {
                with(vec![10], 0)(r);
                if let TourStep::ExamplesAndTests { folders, .. } = &mut r.tour.steps[5] {
                    folders[0] = 0;
                }
            }),
            InvalidResult::TourCount { row: 5 }
        );
    }

    #[test]
    fn counts_of_packages_hold_together() {
        assert_eq!(
            invalid_monorepo(|r| {
                if let TourStep::Applications { app_files, .. } = &mut r.tour.steps[1] {
                    *app_files = 1;
                }
            }),
            InvalidResult::TourCount { row: 1 }
        );
        assert_eq!(
            invalid_monorepo(|r| {
                if let TourStep::InsidePackage { files, .. } = &mut r.tour.steps[3] {
                    files.push(1);
                }
            }),
            InvalidResult::TourCount { row: 3 }
        );
        assert_eq!(
            invalid_monorepo(|r| {
                if let TourStep::Cycles { package, .. } = &mut r.tour.steps[4] {
                    *package = Some(0);
                }
            }),
            InvalidResult::TourCount { row: 4 }
        );
    }
}
