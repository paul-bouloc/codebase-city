//! The guided tour: which steps have something measured to show, and what.
//!
//! The tour is read from the rest of the result, not from the import graph,
//! so a stored result can be given a new tour without its repository. A
//! step only comes when it has a fact worth a sentence; the sentences are
//! the web app's.
//!
//! A monorepo's tour presents its packages: its apps, its libraries and
//! what links them. Another repository's presents its files: where the
//! code starts, what pulls it together, what it rests on.

mod apps;
mod complexity;
mod consumers;
#[cfg(test)]
mod fixture;
mod libraries;
mod monorepo;
mod overview;
mod rest;
mod roles;
mod structure;

use model::{AnalysisResult, Scope, Tour, TourStep};

/// The most rows a list of a step holds.
const MAX_ROWS: usize = 3;

/// Below this many files, or without a file the analyzer reads, the tour
/// is the overview alone.
const MIN_FILES: u32 = 5;

/// The tour of a result. The result must be valid
/// (`AnalysisResult::validate`) but for its tour: its indexes are trusted.
pub fn of_result(result: &AnalysisResult) -> Tour {
    let overview = overview::step(result);
    let mut steps = Vec::new();
    let small = matches!(overview, TourStep::Overview { files, .. } if files < MIN_FILES);
    steps.push(overview);
    if small || !reads_code(result) {
        return Tour { steps };
    }
    let repo = monorepo::Monorepo::of(result);
    if let Some(repo) = &repo {
        steps.extend(apps::applications(repo));
        steps.extend(apps::other_apps(repo));
        steps.extend(libraries::libraries(repo));
        steps.extend(libraries::app_links(repo));
        // The apps sit above the libraries: their layers say nothing more
        if !repo.has_apps() {
            steps.extend(structure::layers(result));
        }
        steps.extend(consumers::consumers(repo));
        steps.extend(apps::inside_app(repo));
    } else {
        let entries = roles::entry_points(result);
        let conductors = roles::conductors(result, entries.as_ref());
        steps.extend(entries);
        steps.extend(conductors);
        steps.extend(roles::foundations(result));
        steps.extend(structure::layers(result));
    }
    steps.extend(structure::cycles(result, repo.as_ref()));
    steps.extend(complexity::complex_areas(result, repo.as_ref()));
    steps.extend(rest::rest(result));
    Tour { steps }
}

/// Whether some production file is in a language the analyzer reads.
fn reads_code(result: &AnalysisResult) -> bool {
    let files = &result.files;
    (0..files.dir.len()).any(|file| is_production(result, file) && files.complexity[file].is_some())
}

/// Source code that is not generated: what the rankings look at.
fn is_production(result: &AnalysisResult, file: usize) -> bool {
    result.files.scope[file] == Scope::Source && !result.files.generated[file]
}

/// The island of a file.
fn island_of_file(result: &AnalysisResult, file: usize) -> Option<u32> {
    result.dirs.island[result.files.dir[file] as usize]
}

/// The index with the highest value, the first one on a tie; `None` when
/// every value is zero.
fn first_max(values: impl IntoIterator<Item = u64>) -> Option<u32> {
    let mut best: Option<(usize, u64)> = None;
    for (index, value) in values.into_iter().enumerate() {
        if value > 0 && best.is_none_or(|(_, best)| value > best) {
            best = Some((index, value));
        }
    }
    best.map(|(index, _)| crate::saturating_u32(index))
}

/// A count of files or lines, as the result stores them.
fn count(value: u64) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use fixture::Fixture;

    fn kinds(tour: &Tour) -> Vec<&'static str> {
        tour.steps
            .iter()
            .map(|step| match step {
                TourStep::Overview { .. } => "overview",
                TourStep::EntryPoints { .. } => "entryPoints",
                TourStep::Conductors { .. } => "conductors",
                TourStep::Foundations { .. } => "foundations",
                TourStep::Applications { .. } => "applications",
                TourStep::OtherApps { .. } => "otherApps",
                TourStep::Libraries { .. } => "libraries",
                TourStep::AppLinks { .. } => "appLinks",
                TourStep::Layers { .. } => "layers",
                TourStep::Consumers { .. } => "consumers",
                TourStep::InsideApp { .. } => "insideApp",
                TourStep::Cycles { .. } => "cycles",
                TourStep::ComplexAreas { .. } => "complexAreas",
                TourStep::Rest { .. } => "rest",
            })
            .collect()
    }

    #[test]
    fn a_small_repository_gets_the_overview_alone() {
        let mut repo = Fixture::new();
        for name in ["a", "b", "c", "d"] {
            let file = repo.file(&format!("src/{name}.ts"), Scope::Source);
            repo.result.files.dependents[file] = Some(3);
        }
        repo.entry(0);
        let tour = of_result(&repo.result);
        assert_eq!(kinds(&tour), ["overview"]);
        assert_eq!(repo.validated(tour).steps.len(), 1);
    }

    #[test]
    fn a_repository_without_code_the_analyzer_reads_gets_the_overview_alone() {
        let mut repo = Fixture::new();
        for name in ["a", "b", "c", "d", "e"] {
            let file = repo.file(&format!("src/{name}.css"), Scope::Source);
            repo.result.files.complexity[file] = None;
        }
        repo.entry(0);
        assert_eq!(kinds(&of_result(&repo.result)), ["overview"]);
    }

    #[test]
    fn steps_come_in_order_and_empty_ones_are_skipped() {
        let mut repo = Fixture::layered();
        let tour = repo.validated(of_result(&repo.result));
        assert_eq!(
            kinds(&tour),
            ["overview", "entryPoints", "foundations", "layers", "rest"]
        );
        repo.result.cycles.members.push(vec![1, 2]);
        repo.result.cycles.shortest.push(vec![1, 2]);
        let tour = repo.validated(of_result(&repo.result));
        assert_eq!(
            kinds(&tour),
            [
                "overview",
                "entryPoints",
                "foundations",
                "layers",
                "cycles",
                "rest"
            ]
        );
    }

    #[test]
    fn a_monorepo_gets_the_tour_of_its_packages() {
        let mut repo = Fixture::monorepo();
        let tour = repo.validated(of_result(&repo.result));
        assert_eq!(
            kinds(&tour),
            [
                "overview",
                "applications",
                "otherApps",
                "libraries",
                "appLinks",
                "insideApp",
                "rest"
            ]
        );
        // Without apps: layers when the islands have them, and no step of
        // apps
        repo.result.packages.kind[..6].fill(model::PackageKind::Library);
        let [apps, libs] = ["apps", "libs"].map(|name| repo.island(name));
        let islands = repo.result.islands.dir.len();
        repo.result.islands.layer = vec![None; islands];
        repo.result.islands.layer[apps as usize] = Some(2);
        repo.result.islands.layer[libs as usize] = Some(1);
        repo.result.islands.layer[0] = Some(1);
        repo.link(0, apps, 1, 1);
        repo.link(apps, libs, 3, 0);
        let tour = repo.validated(of_result(&repo.result));
        assert_eq!(kinds(&tour), ["overview", "libraries", "layers", "rest"]);
    }

    #[test]
    fn a_workspace_of_one_package_of_code_gets_the_tour_of_files() {
        let mut repo = Fixture::monorepo();
        repo.result.packages.code_files.fill(0);
        repo.result.packages.code_files[0] = 100;
        let tour = repo.validated(of_result(&repo.result));
        assert!(!kinds(&tour).contains(&"applications"));
        assert!(!kinds(&tour).contains(&"libraries"));
    }

    #[test]
    fn the_sample_written_by_hand_has_the_tour_the_analyzer_finds() {
        let json = include_str!("../../../web/src/data/generated/sample-result.json");
        let sample: AnalysisResult = serde_json::from_str(json).unwrap();
        assert_eq!(of_result(&sample), sample.tour);
    }

    #[test]
    fn the_first_max_is_the_first_of_the_highest() {
        assert_eq!(first_max([1, 3, 3, 2]), Some(1));
        assert_eq!(first_max([0, 0]), None);
        assert_eq!(first_max([]), None);
    }
}
