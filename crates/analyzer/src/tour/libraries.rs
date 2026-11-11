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
/// The main library of a monorepo of libraries is imported by this many
/// packages at least: fewer, it is one library among others.
const MIN_MAIN_IMPORTERS: usize = 3;
/// The main library holds this share of the libraries' code, in percent,
/// at least.
const MIN_MAIN_SHARE: u64 = 5;

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
    let mut ranked: Vec<(u32, u32)> = libraries_of(repo)
        .into_iter()
        .map(|library| (library, index(repo.importers(library).len())))
        .filter(|&(_, importers)| importers > 0)
        .collect();
    ranked.sort_by_key(|&(library, importers)| (std::cmp::Reverse(importers), library));
    ranked.truncate(MAX_MOST_IMPORTED);
    ranked
}

/// The library a monorepo of libraries is about: the one with the most
/// code files times the packages that import it. The largest alone is
/// often generated code (`@babel/helpers`), the most imported alone a
/// one-file helper (`@babel/helper-plugin-utils`); their product finds
/// `@babel/core`, `@vue/runtime-core` and `@sveltejs/kit`. `None` for a
/// collection of libraries that none leads (the contributions of
/// OpenTelemetry).
pub(super) fn main_library(repo: &Monorepo<'_>) -> Option<u32> {
    let files = &repo.result.packages.code_files;
    let libraries = libraries_of(repo);
    let library_files: u64 = libraries
        .iter()
        .map(|&library| u64::from(files[library as usize]))
        .sum();
    libraries
        .into_iter()
        .map(|library| {
            let importers = repo.importers(library).len();
            (library, u64::from(files[library as usize]), importers)
        })
        .filter(|&(_, files, importers)| {
            importers >= MIN_MAIN_IMPORTERS && files * 100 >= library_files * MIN_MAIN_SHARE
        })
        .max_by_key(|&(library, files, importers)| {
            (files * importers as u64, std::cmp::Reverse(library))
        })
        .map(|(library, _, _)| library)
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
    // Unless apps lead, the libraries at the top are imported by no package
    // by design (nest's platforms): only libraries that serve apps can be
    // left unused
    let serve_apps = if repo.apps_lead() {
        libraries.as_slice()
    } else {
        &[]
    };
    for &library in serve_apps {
        let importers: Vec<u32> = repo
            .importers(library)
            .iter()
            .map(|&(from, _)| from)
            .collect();
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
    if !repo.apps_lead() {
        return None;
    }
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
            .iter()
            .filter(|(from, _)| repo.is_app(*from))
            .map(|&(from, link)| (from, link.files, link.type_only))
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
        // Nor with apps that do not lead, and they share nothing
        let mut fixture = Fixture::monorepo();
        fixture.result.packages.code_files[12] = 2_000;
        let Some(TourStep::Libraries {
            single_app, unused, ..
        }) = libraries(&repo(&fixture))
        else {
            unreachable!()
        };
        assert!(single_app.is_empty() && unused.is_empty());
        assert_eq!(app_links(&repo(&fixture)), None);
    }

    #[test]
    fn the_main_library_has_the_most_files_times_importers() {
        // log 5 importers, types 4, core 3, contracts 2
        let mut fixture = Fixture::monorepo();
        let files = &mut fixture.result.packages.code_files;
        files[6] = 10;
        files[7] = 20;
        files[8] = 30;
        assert_eq!(main_library(&repo(&fixture)), Some(8));
        // Two importers are not enough, however large
        fixture.result.packages.code_files[10] = 100;
        assert_eq!(main_library(&repo(&fixture)), Some(8));
        // Below 5% of the libraries' code, no library leads
        fixture.result.packages.code_files[12] = 1_000;
        assert_eq!(main_library(&repo(&fixture)), None);
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
