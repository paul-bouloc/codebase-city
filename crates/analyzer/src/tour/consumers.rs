//! Who uses the packages of a monorepo without apps: the examples and
//! tests around them.

use std::collections::{BTreeMap, BTreeSet};

use model::{Consumer, Scope, TourStep};

use super::monorepo::Monorepo;
use super::{MAX_ROWS, count, first_max};

/// Fewer folders that import the packages make no step.
const MIN_FOLDERS: usize = 3;

/// The folders at the top of the repository, outside the packages and
/// holding none, whose examples and tests import a package. Skipped when the repository has
/// apps: they are what uses the libraries.
pub(super) fn consumers(repo: &Monorepo<'_>) -> Option<TourStep> {
    if repo.has_apps() {
        return None;
    }
    let result = repo.result;
    let parents = &result.dirs.parent;
    // The top folder of each folder, and the folder right below it
    let mut top = vec![None; parents.len()];
    let mut below_top = vec![None; parents.len()];
    for dir in 1..parents.len() {
        match parents[dir] {
            Some(0) => top[dir] = Some(dir),
            Some(parent) => {
                top[dir] = top[parent as usize];
                below_top[dir] = below_top[parent as usize].or(Some(dir));
            }
            None => {}
        }
    }
    // A top folder that holds packages, such as `packages/`, is split into
    // their islands: it has no ground of its own to show
    let mut holds_package = vec![false; parents.len()];
    for &dir in &result.packages.dir {
        if let Some(top) = top[dir as usize] {
            holds_package[top] = true;
        }
    }
    let files = &result.files;
    let edges = &result.edges;
    let mut imports: BTreeMap<usize, u64> = BTreeMap::new();
    let mut folders: BTreeMap<usize, BTreeSet<usize>> = BTreeMap::new();
    let mut by_package = vec![0u64; result.packages.dir.len()];
    for edge in 0..edges.from.len() {
        let file = edges.from[edge] as usize;
        let uses = matches!(
            files.scope[file],
            Scope::Example | Scope::Test | Scope::Fixture
        );
        if !uses || files.generated[file] || repo.package_of_file(file).is_some() {
            continue;
        }
        let Some(package) = repo.target_package(edge) else {
            continue;
        };
        let dir = files.dir[file] as usize;
        let Some(top) = top[dir].filter(|&top| !holds_package[top]) else {
            continue;
        };
        *imports.entry(top).or_default() += 1;
        by_package[package as usize] += 1;
        if let Some(folder) = below_top[dir] {
            folders.entry(top).or_default().insert(folder);
        }
    }
    let total: usize = folders.values().map(BTreeSet::len).sum();
    if total < MIN_FOLDERS {
        return None;
    }
    let mut ranked: Vec<(u64, usize)> = imports
        .into_iter()
        .map(|(dir, imports)| (imports, dir))
        .collect();
    ranked.sort_by_key(|&(imports, dir)| (std::cmp::Reverse(imports), dir));
    ranked.truncate(MAX_ROWS);
    Some(TourStep::Consumers {
        folders: ranked
            .into_iter()
            .map(|(imports, dir)| Consumer {
                dir: crate::saturating_u32(dir),
                folders: crate::saturating_u32(folders.get(&dir).map_or(0, BTreeSet::len)),
                imports: count(imports),
            })
            .collect(),
        package: first_max(by_package)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tour::fixture::Fixture;
    use model::{EdgeKind, PackageKind};

    /// The monorepo without apps, and examples and tests that import its
    /// libraries.
    fn libraries_and_consumers() -> Fixture {
        let mut fixture = Fixture::monorepo();
        fixture.result.packages.kind[..6].fill(PackageKind::Library);
        let log = fixture.file_at("libs/log/index.ts");
        let types = fixture.file_at("libs/types/index.ts");
        for (path, scope, targets) in [
            ("sample/01-cats/main.ts", Scope::Example, &[log, types][..]),
            ("sample/02-dogs/main.ts", Scope::Example, &[log]),
            ("integration/scopes/a.spec.ts", Scope::Test, &[types]),
            ("integration/scopes/b.spec.ts", Scope::Test, &[types]),
            // Outside any folder of consumers, or not a consumer
            ("smoke.test.ts", Scope::Test, &[log]),
            ("tools/build.ts", Scope::Build, &[log]),
        ] {
            let file = fixture.file(path, scope);
            for &target in targets {
                fixture.import(file, target, EdgeKind::Import);
            }
        }
        fixture.sort_edges();
        fixture
    }

    #[test]
    fn examples_and_tests_around_the_packages() {
        let mut fixture = libraries_and_consumers();
        let [sample, integration] = ["sample", "integration"].map(|dir| fixture.dir(dir));
        let repo = Monorepo::of(&fixture.result).unwrap();
        assert_eq!(
            consumers(&repo),
            Some(TourStep::Consumers {
                folders: vec![
                    Consumer {
                        dir: sample,
                        folders: 2,
                        imports: 3,
                    },
                    Consumer {
                        dir: integration,
                        folders: 1,
                        imports: 2,
                    },
                ],
                // types: 3 imports, log: 2
                package: 7,
            })
        );
    }

    #[test]
    fn consumers_need_three_folders_and_no_app() {
        let mut fixture = libraries_and_consumers();
        fixture.result.packages.kind[0] = PackageKind::App;
        assert_eq!(consumers(&Monorepo::of(&fixture.result).unwrap()), None);
        let mut fixture = libraries_and_consumers();
        let dogs = fixture.file_at("sample/02-dogs/main.ts");
        fixture.result.files.scope[dogs] = Scope::Source;
        assert_eq!(consumers(&Monorepo::of(&fixture.result).unwrap()), None);
    }

    #[test]
    fn a_folder_that_holds_packages_is_no_consumer() {
        let mut fixture = libraries_and_consumers();
        let types = fixture.file_at("libs/types/index.ts");
        for name in ["a", "b", "c", "d"] {
            let test = fixture.file(&format!("libs/__tests__/{name}/t.test.ts"), Scope::Test);
            fixture.import(test, types, EdgeKind::Import);
        }
        fixture.sort_edges();
        let repo = Monorepo::of(&fixture.result).unwrap();
        let Some(TourStep::Consumers { folders, .. }) = consumers(&repo) else {
            unreachable!()
        };
        assert_eq!(folders.len(), 2);
    }
}
