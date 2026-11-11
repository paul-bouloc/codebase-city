//! The steps of a monorepo's tour, with the package names and numbers their
//! sentences quote.

use model::{AnalysisResult, TourStep};

use crate::paths::{dir_path, path};

/// Names of packages, with their code files.
fn names(result: &AnalysisResult, packages: &[u32]) -> String {
    let named: Vec<String> = packages
        .iter()
        .map(|&package| {
            let package = package as usize;
            format!(
                "{} ({})",
                result.packages.name[package], result.packages.code_files[package]
            )
        })
        .collect();
    named.join(", ")
}

fn framework(result: &AnalysisResult, package: u32) -> String {
    result.packages.framework[package as usize]
        .map_or_else(|| "-".to_owned(), |framework| format!("{framework:?}"))
}

pub(crate) fn print_package_step(result: &AnalysisResult, step: &TourStep) {
    let packages = &result.packages;
    match step {
        TourStep::Applications { units, app_files } => {
            println!("  apps        {app_files} code files in all the apps; main units:");
            for unit in units {
                let group = unit.group.map_or_else(String::new, |group| {
                    format!(" group {}", result.package_groups.prefix[group as usize])
                });
                let first = unit.apps[0];
                println!(
                    "              {} files ({:.1}%){group}: {} [{}; {} routes, {} API]",
                    unit.files,
                    100.0 * f64::from(unit.files) / f64::from((*app_files).max(1)),
                    names(result, &unit.apps),
                    framework(result, first),
                    packages.route_count[first as usize],
                    packages.api_route_count[first as usize],
                );
            }
        }
        TourStep::OtherApps { apps } => {
            println!("  other apps  {}", apps.len());
            for &app in apps {
                println!(
                    "              {} ({}) {}",
                    packages.name[app as usize],
                    packages.code_files[app as usize],
                    framework(result, app)
                );
            }
        }
        TourStep::Libraries {
            most_imported,
            importers,
            largest,
            single_app,
            unused,
        } => {
            let libraries = packages
                .kind
                .iter()
                .filter(|kind| **kind == model::PackageKind::Library)
                .count();
            println!("  libraries   {libraries}; most imported:");
            for (library, importers) in most_imported.iter().zip(importers) {
                println!(
                    "              {} by {importers} packages",
                    packages.name[*library as usize]
                );
            }
            println!("              largest {}", names(result, &[*largest]));
            println!("              single app: {}", names(result, single_app));
            println!("              unused: {}", names(result, unused));
        }
        TourStep::AppLinks {
            app_imports,
            shared,
        } => {
            println!("  app links   {app_imports} production imports between apps");
            for shared in shared {
                println!(
                    "              {} by {}: {} files, {} types only",
                    packages.name[shared.library as usize],
                    names(result, &shared.apps),
                    shared.files,
                    shared.type_only
                );
            }
        }
        TourStep::Consumers { folders, package } => {
            println!(
                "  consumers   most imported {}",
                packages.name[*package as usize]
            );
            for folder in folders {
                println!(
                    "              {}: {} folders, {} imports",
                    dir_path(result, folder.dir),
                    folder.folders,
                    folder.imports
                );
            }
        }
        TourStep::InsideApp { app, dirs, files } => {
            let entry = packages.entry[*app as usize]
                .map_or_else(|| "-".to_owned(), |file| path(result, file as usize));
            println!(
                "  inside      {} (entry {entry})",
                packages.name[*app as usize]
            );
            for (dir, files) in dirs.iter().zip(files) {
                println!(
                    "              {} {files} code files",
                    dir_path(result, *dir)
                );
            }
        }
        _ => {}
    }
}
