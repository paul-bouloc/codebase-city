//! The tour, step by step, with the paths and numbers its sentences quote.

use model::{AnalysisResult, TourStep};

use crate::paths::{dir_path, path, target};
use crate::tour_packages::print_package_step;

/// The islands of a layer printed by name; the others are counted.
const MAX_LAYER_NAMES: usize = 3;

/// A share as a percentage with one decimal.
fn share(part: u32, whole: u32) -> String {
    if whole == 0 {
        return "-".to_owned();
    }
    format!("{:.1}%", 100.0 * f64::from(part) / f64::from(whole))
}

pub(crate) fn print_tour(result: &AnalysisResult) {
    let island = |island: u32| dir_path(result, result.islands.dir[island as usize]);
    println!("tour          {} steps", result.tour.steps.len());
    for step in &result.tour.steps {
        match step {
            TourStep::Overview {
                files,
                generated,
                lines,
                language,
                language_lines,
                language_read,
                biggest_island,
                outside_island,
            } => {
                let language =
                    language.map_or("-", |language| result.languages[language as usize].as_str());
                println!(
                    "  overview    {files} files ({generated} generated), {} islands, \
                     {lines} lines of code, {language} {}",
                    result.islands.dir.len(),
                    share(*language_lines, *lines)
                );
                if !language_read && language != "-" {
                    println!("              {language} is not analyzed");
                }
                if let Some(biggest) = biggest_island {
                    println!("              biggest island {}", island(*biggest));
                }
                if let Some(outside) = outside_island {
                    println!("              outside the code {}", island(*outside));
                }
            }
            TourStep::BuiltOn {
                externals,
                code_files,
            } => {
                let table = &result.externals;
                let named: Vec<String> = externals
                    .iter()
                    .map(|&row| {
                        let row = row as usize;
                        format!(
                            "{} ({}, {})",
                            table.name[row],
                            share(table.files[row], *code_files),
                            path(result, table.manifest[row] as usize)
                        )
                    })
                    .collect();
                println!("  built on    {}", named.join(", "));
            }
            TourStep::EntryPoints { entries } => {
                let roles = &result.roles.entries;
                println!("  entries");
                for &row in entries {
                    let row = row as usize;
                    let reasons: Vec<String> = roles.reasons[row]
                        .iter()
                        .map(|reason| format!("{reason:?}"))
                        .collect();
                    println!(
                        "              {} ({})",
                        target(result, roles.file[row], roles.dir[row]),
                        reasons.join(", ")
                    );
                }
            }
            TourStep::Conductors { conductors } => {
                let ranked = &result.roles.conductors;
                println!("  conductors");
                for &row in conductors {
                    let row = row as usize;
                    println!(
                        "              {} pulls together {} files",
                        target(result, ranked.file[row], ranked.dir[row]),
                        ranked.count[row]
                    );
                }
            }
            TourStep::Foundations {
                foundations,
                island: rests_on,
            } => {
                let ranked = &result.roles.foundations;
                println!(
                    "  foundations rests on {}",
                    rests_on.map_or_else(|| "-".to_owned(), island)
                );
                for &row in foundations {
                    let row = row as usize;
                    println!(
                        "              {} files depend on {}",
                        ranked.count[row],
                        target(result, ranked.file[row], ranked.dir[row])
                    );
                }
            }
            TourStep::Layers {
                down,
                level,
                up,
                worst_link,
            } => {
                let mut layers: Vec<(u32, String)> = (0..result.islands.dir.len())
                    .filter_map(|row| {
                        let layer = result.islands.layer[row]?;
                        Some((layer, island(row as u32)))
                    })
                    .collect();
                layers.sort();
                let count = layers.last().map_or(0, |layer| layer.0);
                let order: Vec<String> = (1..=count)
                    .map(|layer| {
                        let names: Vec<&str> = layers
                            .iter()
                            .filter(|(of, _)| *of == layer)
                            .map(|(_, name)| name.as_str())
                            .collect();
                        // Sixty islands in a layer would hide the order
                        if names.len() > MAX_LAYER_NAMES {
                            let more = names.len() - MAX_LAYER_NAMES;
                            format!("{} (+{more} more)", names[..MAX_LAYER_NAMES].join(" "))
                        } else {
                            names.join(" ")
                        }
                    })
                    .collect();
                let total = down + level + up;
                println!("  layers      {count}: {}", order.join(" → "));
                println!(
                    "              {total} imports: {} down, {} level, {} up",
                    share(*down, total),
                    share(*level, total),
                    share(*up, total)
                );
                if let Some(link) = worst_link {
                    let links = &result.links;
                    let link = *link as usize;
                    println!(
                        "              most up: {} → {} ({}, {} in production)",
                        island(links.from[link]),
                        island(links.to[link]),
                        links.upward[link],
                        links.production_upward[link]
                    );
                }
            }
            TourStep::Applications { .. }
            | TourStep::OtherApps { .. }
            | TourStep::Libraries { .. }
            | TourStep::AppLinks { .. }
            | TourStep::Consumers { .. }
            | TourStep::InsidePackage { .. } => print_package_step(result, step),
            TourStep::Cycles {
                cycle,
                dir,
                package,
                in_package,
                crossing,
            } => {
                let members = &result.cycles.members[*cycle as usize];
                let shortest: Vec<String> = result.cycles.shortest[*cycle as usize]
                    .iter()
                    .map(|&file| path(result, file as usize))
                    .collect();
                println!(
                    "  cycles      {} of them; {} files in {}",
                    result.cycles.members.len(),
                    members.len(),
                    dir_path(result, *dir)
                );
                println!("              shortest loop: {}", shortest.join(" → "));
                if let Some(package) = package {
                    println!(
                        "              in package {}: {in_package} loops; {crossing} cross packages",
                        result.packages.name[*package as usize]
                    );
                }
            }
            TourStep::ComplexAreas { files, complexity } => {
                println!("  complex     total {complexity}");
                for &file in files {
                    let measured = result.files.complexity[file as usize].unwrap_or(0);
                    println!(
                        "              {} complexity {measured} ({}), {} dependents",
                        path(result, file as usize),
                        share(measured, *complexity),
                        result.files.dependents[file as usize].unwrap_or(0)
                    );
                }
            }
            TourStep::Rest {
                tests,
                examples,
                docs,
                config,
                root_config,
                park_count,
                park_tests,
                parks,
            } => {
                println!(
                    "  rest        {tests} tests, {park_tests} of them in {park_count} parks, \
                     {examples} examples, {docs} docs, {config} config ({root_config} at the root)"
                );
                let parks: Vec<String> = parks.iter().map(|&dir| dir_path(result, dir)).collect();
                println!("              largest parks: {}", parks.join(", "));
            }
        }
    }
}
