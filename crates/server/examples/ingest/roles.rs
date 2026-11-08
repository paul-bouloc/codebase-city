//! The roles found: entry points, foundations and conductors, against
//! what a person expects.

use model::AnalysisResult;

use crate::expected::Expected;
use crate::paths::{dir_path, path, target};

/// How many of the first `k` paths a person expects, as "hits/k".
fn precision(found: &[String], expected: &[String], k: usize) -> String {
    let shown = found.len().min(k);
    let hits = found
        .iter()
        .take(k)
        .filter(|path| expected.contains(path))
        .count();
    format!("{hits}/{shown}")
}

pub(crate) fn print_roles(
    result: &AnalysisResult,
    report: &analyzer::RolesReport,
    expected: Option<&Expected>,
) {
    let files = &result.files;
    let counted: Vec<u32> = files.dependencies.iter().flatten().copied().collect();
    let propagation = if counted.is_empty() {
        0.0
    } else {
        100.0 * counted.iter().map(|&count| f64::from(count)).sum::<f64>()
            / (counted.len() as f64 * counted.len() as f64)
    };
    println!(
        "units         {} ({} loops, largest {}), {}, propagation cost {propagation:.1}%",
        report.units,
        report.loops,
        report.largest_loop,
        if report.counted {
            "counted"
        } else {
            "too large to count"
        }
    );

    let roles = &result.roles;
    let entries: Vec<String> = (0..roles.entries.file.len())
        .map(|row| target(result, roles.entries.file[row], roles.entries.dir[row]))
        .collect();
    println!("entries");
    for (row, path) in entries.iter().enumerate() {
        let reasons: Vec<String> = roles.entries.reasons[row]
            .iter()
            .map(|reason| format!("{reason:?}"))
            .collect();
        let command = roles.entries.command[row]
            .as_deref()
            .map(|command| format!(" `{command}`"))
            .unwrap_or_default();
        println!("  {path}{command}: {}", reasons.join(", "));
    }
    let ranked = |label: &str, ranked: &model::Ranked| -> Vec<String> {
        println!("{label}");
        (0..ranked.count.len())
            .map(|row| {
                let path = target(result, ranked.file[row], ranked.dir[row]);
                println!("  {:>6}  {path}", ranked.count[row]);
                path
            })
            .collect()
    };
    let foundations = ranked("foundations (dependents)", &roles.foundations);
    let conductors = ranked("conductors (dependencies)", &roles.conductors);

    if let Some(expected) = expected {
        println!(
            "expected      entries {} at 3, foundations {} at 5, conductors {} at 5",
            precision(&entries, &expected.entries, 3),
            precision(&foundations, &expected.foundations, 5),
            precision(&conductors, &expected.conductors, 5)
        );
        let known: std::collections::HashSet<String> = (0..files.name.len())
            .map(|row| path(result, row))
            .chain(
                (0..result.dirs.name.len())
                    .map(|row| dir_path(result, u32::try_from(row).unwrap_or(u32::MAX))),
            )
            .collect();
        for wanted in expected
            .entries
            .iter()
            .chain(&expected.foundations)
            .chain(&expected.conductors)
            .filter(|wanted| !known.contains(*wanted))
        {
            println!("  not in repo {wanted}");
        }
    }
}
