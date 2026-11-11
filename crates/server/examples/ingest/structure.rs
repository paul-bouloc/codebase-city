//! The structure of the city: its islands, their layers, the links that
//! go up, and the cycles.

use model::AnalysisResult;

use crate::expected::Expected;
use crate::paths::{dir_path, path};

/// How many islands to list, the largest first, and upward links and
/// cycles.
const STRUCTURE_SHOWN: usize = 12;

pub(crate) fn print_structure(result: &AnalysisResult, expected: Option<&Expected>) {
    let islands = &result.islands;
    let name = |island: u32| {
        let path = dir_path(result, islands.dir[island as usize]);
        match path.trim_end_matches('/') {
            "" => "/".to_owned(),
            path => path.to_owned(),
        }
    };
    let mut files = vec![0u32; islands.dir.len()];
    let mut production = vec![0u32; islands.dir.len()];
    for (file, &dir) in result.files.dir.iter().enumerate() {
        if let Some(island) = result.dirs.island[dir as usize] {
            files[island as usize] += 1;
            if result.files.scope[file] == model::Scope::Source && !result.files.generated[file] {
                production[island as usize] += 1;
            }
        }
    }
    let layers = islands.layer.iter().flatten().max().copied().unwrap_or(0);
    println!("islands       {} in {layers} layers", islands.dir.len());
    let mut order: Vec<u32> = (0..u32::try_from(islands.dir.len()).unwrap_or(u32::MAX)).collect();
    order.sort_by_key(|&island| {
        (
            std::cmp::Reverse(production[island as usize]),
            std::cmp::Reverse(files[island as usize]),
            island,
        )
    });
    for &island in order.iter().take(STRUCTURE_SHOWN) {
        let layer = islands.layer[island as usize]
            .map_or_else(|| "-".to_owned(), |layer| layer.to_string());
        println!(
            "  {:>6} files {:>6} prod  layer {layer:>2}  {}",
            files[island as usize],
            production[island as usize],
            name(island)
        );
    }
    for layer in 1..=layers {
        let names: Vec<String> = (0..islands.dir.len())
            .filter(|&island| islands.layer[island] == Some(layer))
            .map(|island| name(u32::try_from(island).unwrap_or(u32::MAX)))
            .collect();
        println!("  layer {layer:>2}  {}", names.join(", "));
    }

    let links = &result.links;
    let layer_of = |island: u32| islands.layer[island as usize];
    let mut between = 0u32;
    let (mut production, mut production_up) = (0u32, 0u32);
    let mut upward: Vec<(u32, usize)> = Vec::new();
    for row in 0..links.from.len() {
        if layer_of(links.from[row]).is_some() && layer_of(links.to[row]).is_some() {
            between += links.imports[row];
            production += links.production[row];
            production_up += links.production_upward[row];
        }
        if links.upward[row] > 0 {
            upward.push((links.upward[row], row));
        }
    }
    let up: u32 = upward.iter().map(|&(imports, _)| imports).sum();
    println!(
        "links         {} pairs, {up} of {between} imports between layered islands go up ({:.2}%)",
        links.from.len(),
        if between == 0 {
            0.0
        } else {
            100.0 * f64::from(up) / f64::from(between)
        }
    );
    println!(
        "              in production: {production_up} of {production} ({:.2}%)",
        if production == 0 {
            0.0
        } else {
            100.0 * f64::from(production_up) / f64::from(production)
        }
    );
    upward.sort_by_key(|&(imports, row)| (std::cmp::Reverse(imports), row));
    for &(imports, row) in upward.iter().take(STRUCTURE_SHOWN / 2) {
        println!(
            "  up {imports:>6}  {} -> {}",
            name(links.from[row]),
            name(links.to[row])
        );
    }

    let cycles = &result.cycles;
    let in_cycles: usize = cycles.members.iter().map(Vec::len).sum();
    println!("cycles        {} ({in_cycles} files)", cycles.members.len());
    for (members, shortest) in cycles
        .members
        .iter()
        .zip(&cycles.shortest)
        .take(STRUCTURE_SHOWN / 2)
    {
        let path: Vec<String> = shortest
            .iter()
            .map(|&file| path(result, file as usize))
            .collect();
        println!("  {:>5} files, e.g. {}", members.len(), path.join(" -> "));
    }

    let Some(expected) = expected.filter(|expected| !expected.layers.is_empty()) else {
        return;
    };
    let by_name: std::collections::HashMap<String, Option<u32>> = (0..islands.dir.len())
        .map(|island| {
            let island = u32::try_from(island).unwrap_or(u32::MAX);
            (name(island), layer_of(island))
        })
        .collect();
    let mut right = 0;
    let mut pairs = 0;
    for (low, lower) in expected.layers.iter().enumerate() {
        for higher in &expected.layers[low + 1..] {
            for a in lower {
                for b in higher {
                    pairs += 1;
                    let (a, b) = (
                        by_name.get(a).copied().flatten(),
                        by_name.get(b).copied().flatten(),
                    );
                    if matches!((a, b), (Some(a), Some(b)) if a < b) {
                        right += 1;
                    }
                }
            }
        }
    }
    println!("expected      layers {right}/{pairs} ordered pairs in order");
    for wanted in expected.layers.iter().flatten() {
        if !by_name.contains_key(wanted) {
            println!("  not an island {wanted}");
        }
    }
}
