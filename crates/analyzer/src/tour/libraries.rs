//! The steps of a monorepo's libraries: which packages import them, and
//! what they link between the apps.

use std::collections::{BTreeMap, BTreeSet};

use model::{PackageKind, SharedLibrary, TourStep};

use super::MAX_ROWS;
use super::monorepo::{Monorepo, has_code};
use crate::saturating_u32 as index;

/// The most libraries ranked by their importers: a fourth one is often
/// still one most apps use.
const MAX_MOST_IMPORTED: usize = 4;
/// Fewer libraries make no step.
const MIN_LIBRARIES: usize = 2;
/// Fewer apps share nothing.
const MIN_APPS: usize = 2;

/// How many packages import each library, by library.
fn importer_counts(repo: &Monorepo<'_>) -> BTreeMap<u32, u32> {
    let mut counts = BTreeMap::new();
    for &(_, to) in repo.links.keys() {
        *counts.entry(to).or_insert(0) += 1;
    }
    counts
}

/// The libraries with production code.
fn libraries_of(repo: &Monorepo<'_>) -> Vec<u32> {
    let kinds = &repo.result.packages.kind;
    (0..kinds.len())
        .filter(|&package| kinds[package] == PackageKind::Library && has_code(repo.result, package))
        .map(index)
        .collect()
}

/// The libraries the most packages import, the first first.
fn most_imported(repo: &Monorepo<'_>) -> Vec<(u32, u32)> {
    let counts = importer_counts(repo);
    let mut ranked: Vec<(u32, u32)> = libraries_of(repo)
        .into_iter()
        .filter_map(|library| Some((library, *counts.get(&library)?)))
        .collect();
    ranked.sort_by_key(|&(library, importers)| (std::cmp::Reverse(importers), library));
    ranked.truncate(MAX_MOST_IMPORTED);
    ranked
}

pub(super) fn libraries(repo: &Monorepo<'_>) -> Option<TourStep> {
    let libraries = libraries_of(repo);
    let most = most_imported(repo);
    if libraries.len() < MIN_LIBRARIES || most.is_empty() {
        return None;
    }
    let files = &repo.result.packages.code_files;
    let largest = *libraries
        .iter()
        .max_by_key(|&&library| (files[library as usize], std::cmp::Reverse(library)))?;
    let mut single_app = Vec::new();
    let mut unused = Vec::new();
    // Without apps, the libraries at the top are imported by no package by
    // design (nest's platforms): only libraries that serve apps can be
    // left unused
    let serve_apps = if repo.has_apps() {
        libraries.as_slice()
    } else {
        &[]
    };
    for &library in serve_apps {
        let importers: Vec<u32> = repo.importers(library).map(|(from, _)| from).collect();
        match importers.as_slice() {
            [] => unused.push(library),
            [only] if repo.is_app(*only) => single_app.push(library),
            _ => {}
        }
    }
    Some(TourStep::Libraries {
        most_imported: most.iter().map(|&(library, _)| library).collect(),
        importers: most.iter().map(|&(_, importers)| importers).collect(),
        largest,
        single_app,
        unused,
    })
}

/// What the apps share: their imports of each other, and the libraries
/// that apps of different units import, beyond the most imported ones
/// (`logs` would link them all). A library is ranked by the second unit
/// that imports it the most: shared by two, not used by one.
pub(super) fn app_links(repo: &Monorepo<'_>) -> Option<TourStep> {
    let apps: usize = repo.units.iter().map(|unit| unit.apps.len()).sum();
    if apps < MIN_APPS {
        return None;
    }
    let app_imports: u32 = repo
        .links
        .iter()
        .filter(|((from, to), _)| repo.is_app(*from) && repo.is_app(*to))
        .map(|(_, link)| link.imports)
        .sum();
    let unit_of: BTreeMap<u32, usize> = repo
        .units
        .iter()
        .enumerate()
        .flat_map(|(unit, each)| each.apps.iter().map(move |&app| (app, unit)))
        .collect();
    let most: BTreeSet<u32> = most_imported(repo)
        .into_iter()
        .map(|(library, _)| library)
        .collect();
    let mut ranked: Vec<(u32, SharedLibrary)> = Vec::new();
    for library in libraries_of(repo) {
        if most.contains(&library) {
            continue;
        }
        let mut importing: Vec<(u32, u32, u32)> = repo
            .importers(library)
            .filter(|(from, _)| repo.is_app(*from))
            .map(|(from, link)| (from, link.files, link.type_only))
            .collect();
        importing.sort_by_key(|&(app, files, _)| (std::cmp::Reverse(files), app));
        // The most files of each unit, the largest first
        let mut by_unit: BTreeMap<usize, u32> = BTreeMap::new();
        for &(app, files, _) in &importing {
            let best = by_unit.entry(unit_of[&app]).or_insert(0);
            *best = (*best).max(files);
        }
        let mut by_unit: Vec<u32> = by_unit.into_values().collect();
        by_unit.sort_unstable_by(|a, b| b.cmp(a));
        let Some(&second) = by_unit.get(1) else {
            continue;
        };
        ranked.push((
            second,
            SharedLibrary {
                library,
                apps: importing.iter().map(|&(app, _, _)| app).collect(),
                files: importing.iter().map(|&(_, files, _)| files).sum(),
                type_only: importing.iter().map(|&(_, _, types)| types).sum(),
            },
        ));
    }
    ranked.sort_by_key(|(second, shared)| (std::cmp::Reverse(*second), shared.library));
    let shared: Vec<SharedLibrary> = ranked
        .into_iter()
        .take(MAX_ROWS)
        .map(|(_, shared)| shared)
        .collect();
    (!shared.is_empty()).then_some(TourStep::AppLinks {
        app_imports,
        shared,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tour::fixture::Fixture;
    use model::{EdgeKind, Scope};

    fn repo(fixture: &Fixture) -> Monorepo<'_> {
        Monorepo::of(&fixture.result).unwrap()
    }

    #[test]
    fn libraries_by_the_packages_that_import_them() {
        let mut fixture = Fixture::monorepo();
        fixture.result.packages.code_files[12] = 50;
        assert_eq!(
            libraries(&repo(&fixture)),
            Some(TourStep::Libraries {
                most_imported: vec![6, 7, 8, 9],
                importers: vec![5, 4, 3, 3],
                largest: 12,
                single_app: vec![11],
                unused: vec![12],
            })
        );
    }

    #[test]
    fn a_library_one_other_library_imports_serves_no_app_alone() {
        let mut fixture = Fixture::monorepo();
        let pay = fixture.file_at("libs/pay/index.ts");
        let core = fixture.file_at("libs/core/index.ts");
        fixture.import(core, pay, EdgeKind::Import);
        fixture.sort_edges();
        let Some(TourStep::Libraries { single_app, .. }) = libraries(&repo(&fixture)) else {
            unreachable!()
        };
        assert_eq!(single_app, Vec::<u32>::new());
    }

    #[test]
    fn without_apps_no_library_is_said_unused() {
        let mut fixture = Fixture::monorepo();
        fixture.result.packages.kind[..6].fill(model::PackageKind::Library);
        let Some(TourStep::Libraries {
            single_app, unused, ..
        }) = libraries(&repo(&fixture))
        else {
            unreachable!()
        };
        assert!(single_app.is_empty() && unused.is_empty());
    }

    #[test]
    fn libraries_need_two_of_them_and_an_import() {
        let mut fixture = Fixture::monorepo();
        fixture.result.edges = model::Edges::default();
        assert_eq!(libraries(&repo(&fixture)), None);
        let mut fixture = Fixture::monorepo();
        fixture.result.packages.kind[6..].fill(model::PackageKind::App);
        fixture.result.packages.kind[6] = model::PackageKind::Library;
        assert_eq!(libraries(&repo(&fixture)), None);
    }

    #[test]
    fn apps_share_the_libraries_beyond_the_most_imported() {
        let fixture = Fixture::monorepo();
        assert_eq!(
            app_links(&repo(&fixture)),
            Some(TourStep::AppLinks {
                app_imports: 0,
                shared: vec![SharedLibrary {
                    library: 10,
                    apps: vec![0, 3],
                    files: 2,
                    type_only: 1,
                }],
            })
        );
    }

    #[test]
    fn imports_between_apps_count_in_production_only() {
        let mut fixture = Fixture::monorepo();
        let web = fixture.file_at("apps/web/pages/index.ts");
        let test = fixture.file("apps/admin/index.test.ts", Scope::Test);
        fixture.import(test, web, EdgeKind::Import);
        fixture.sort_edges();
        let step = app_links(&repo(&fixture));
        assert!(matches!(
            step,
            Some(TourStep::AppLinks { app_imports: 0, .. })
        ));
        let admin = fixture.file_at("apps/admin/index.ts");
        fixture.import(admin, web, EdgeKind::Import);
        fixture.sort_edges();
        let step = app_links(&repo(&fixture));
        assert!(matches!(
            step,
            Some(TourStep::AppLinks { app_imports: 1, .. })
        ));
    }

    #[test]
    fn a_library_shared_inside_one_unit_links_nothing() {
        let mut fixture = Fixture::monorepo();
        // contracts: imported by the two apps of `shop` instead
        let contracts = fixture.file_at("libs/contracts/index.ts");
        let [web, admin, shop_a, shop_b] = [
            "apps/web/pages/index.ts",
            "apps/admin/index.ts",
            "apps/shop-a/index.ts",
            "apps/shop-b/index.ts",
        ]
        .map(|path| fixture.file_at(path));
        let edges = &mut fixture.result.edges;
        for edge in 0..edges.from.len() {
            if edges.to[edge] == Some(crate::saturating_u32(contracts)) {
                let from = edges.from[edge] as usize;
                edges.from[edge] = crate::saturating_u32(if from == web { shop_a } else { shop_b });
                assert!(from == web || from == admin);
            }
        }
        fixture.sort_edges();
        assert_eq!(app_links(&repo(&fixture)), None);
    }

    #[test]
    fn packages_without_code_are_neither_libraries_nor_apps() {
        let mut fixture = Fixture::monorepo();
        // lonely, unused, and kiosk, an app, hold tooling only
        fixture.result.packages.code_files[12] = 0;
        fixture.result.packages.code_files[5] = 0;
        let repo = repo(&fixture);
        let Some(TourStep::Libraries { unused, .. }) = libraries(&repo) else {
            unreachable!()
        };
        assert!(unused.is_empty());
        let Some(TourStep::OtherApps { apps }) = super::super::apps::other_apps(&repo) else {
            unreachable!()
        };
        assert_eq!(apps, [3, 4]);
    }
}
