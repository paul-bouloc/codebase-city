//! The layout of the city: its size, how full it is, and where its area went.

use std::time::Instant;

use model::AnalysisResult;

use crate::paths::dir_path;

/// The longest water between two islands that still makes them
/// neighbours, in tenths of a unit: the widest channel.
const NEIGHBOURS: i64 = 240;

/// The size of the city, how full its grids are, the most stretched
/// parcel, and how many links between islands can be bridges: between
/// neighbours at most one layer apart.
pub(crate) fn print_layout(result: &AnalysisResult) {
    let layout = &result.layout;
    let started = Instant::now();
    let again = analyzer::layout::of_result(result);
    let elapsed = started.elapsed();
    let (_, audit) = analyzer::layout::audited(result);
    let grids = &layout.grids;
    let lots: u64 = (0..grids.dir.len())
        .map(|row| u64::from(grids.columns[row]) * u64::from(grids.rows[row]))
        .sum();
    let files = result.files.dir.len();
    println!(
        "layout        {:.0} × {:.0} u, {} parcels, {files} files on {lots} lots ({:.0}%), in {elapsed:.1?}{}",
        f64::from(layout.width) / 10.0,
        f64::from(layout.height) / 10.0,
        layout.parcels.dir.len(),
        100.0 * files as f64 / lots.max(1) as f64,
        if again == *layout {
            ""
        } else {
            ", NOT REPRODUCIBLE"
        }
    );
    print_audit(result, &again, &audit);
    let parcels = &layout.parcels;
    let ratio = |width: u32, height: u32| {
        f64::from(width.max(height)) / f64::from(width.min(height).max(1))
    };
    let worst = (0..parcels.dir.len())
        .map(|row| (ratio(parcels.width[row], parcels.height[row]), row))
        .max_by(|a, b| a.0.total_cmp(&b.0));
    let stretched = (0..parcels.dir.len())
        .filter(|&row| ratio(parcels.width[row], parcels.height[row]) > 4.0)
        .count();
    if let Some((worst, row)) = worst {
        println!(
            "parcels       worst ratio {worst:.1} ({}), {stretched} above 4",
            dir_path(result, parcels.dir[row])
        );
    }
    let plateau = |island: u32| {
        let island = island as usize;
        let islands = &layout.islands;
        (
            i64::from(islands.x[island]),
            i64::from(islands.y[island]),
            i64::from(islands.width[island]),
            i64::from(islands.height[island]),
        )
    };
    let neighbours = |a: u32, b: u32| {
        let (a, b) = (plateau(a), plateau(b));
        let along = |start: i64, length: i64, other: i64, other_length: i64| {
            (other - (start + length)).max(start - (other + other_length))
        };
        let (x, y) = (along(a.0, a.2, b.0, b.2), along(a.1, a.3, b.1, b.3));
        (x < 0 && y <= NEIGHBOURS) || (y < 0 && x <= NEIGHBOURS)
    };
    let links = &result.links;
    let (mut bridges, mut bridged_imports, mut imports) = (0, 0u64, 0u64);
    for row in 0..links.from.len() {
        let (from, to) = (links.from[row], links.to[row]);
        let layer = |island: u32| result.islands.layer[island as usize].unwrap_or(1);
        imports += u64::from(links.imports[row]);
        if neighbours(from, to) && layer(from).abs_diff(layer(to)) <= 1 {
            bridges += 1;
            bridged_imports += u64::from(links.imports[row]);
        }
    }
    if !links.from.is_empty() {
        println!(
            "bridges       {bridges} of {} links ({:.0}%), {:.0}% of their imports",
            links.from.len(),
            100.0 * f64::from(bridges) / links.from.len() as f64,
            100.0 * bridged_imports as f64 / imports.max(1) as f64
        );
    }
}

/// Where the area of `layout`, the city the audit measured, went: what it
/// ends as, then where room was lost, by depth (0: the archipelago, 1: inside the islands, then one more
/// a parcel level), in shares of the city's area.
fn print_audit(result: &AnalysisResult, layout: &model::Layout, audit: &analyzer::layout::Audit) {
    const LOT_AREA: f64 = 400.0;
    let city = f64::from(layout.width) * f64::from(layout.height);
    let share = |area: f64| 100.0 * area / city.max(1.0);
    let sum = |field: fn(&analyzer::layout::AuditLevel) -> u64| {
        audit.levels.iter().map(field).sum::<u64>() as f64
    };
    let files = result.files.dir.len() as f64 * LOT_AREA;
    let asked = sum(|level| level.lots);
    let extra = sum(|level| level.extra_lots);
    let channels = audit.levels.first().map_or(0, |level| level.gaps) as f64;
    let gaps = sum(|level| level.gaps) - channels;
    let plateaux: f64 = (0..layout.islands.x.len())
        .map(|island| {
            f64::from(layout.islands.width[island]) * f64::from(layout.islands.height[island])
        })
        .sum();
    let placed: u64 = (0..layout.grids.dir.len())
        .map(|row| u64::from(layout.grids.columns[row]) * u64::from(layout.grids.rows[row]))
        .sum();
    println!(
        "lots          {:.2} placed per lot asked; files on {:.0}% of the plateaux",
        placed as f64 * LOT_AREA / asked.max(1.0),
        100.0 * files / plateaux.max(1.0)
    );
    println!(
        "area          files {:.0}%, empty lots asked {:.0}%, extra lots {:.0}%, free ground {:.0}%, gaps {:.0}%, padding {:.0}%, channels {:.0}%, water {:.0}%",
        share(files),
        share(asked - files),
        share(extra),
        share(sum(|level| level.ground)),
        share(gaps),
        share(sum(|level| level.padding)),
        share(channels),
        share(sum(|level| level.water)),
    );
    for (depth, level) in audit.levels.iter().enumerate() {
        println!(
            "  depth {depth:>2}    extra lots {:>4.1}%   lost: shorter than row {:>4.1}%, narrower rows {:>4.1}%, reshaped {:>5.1}%",
            share(level.extra_lots as f64),
            share(level.shorter as f64),
            share(level.narrower as f64),
            share(level.reshaped as f64),
        );
    }
}
