//! What the analysis measured: complexity, imports and the import graph.

use std::collections::BTreeMap;

use analyzer::ImportReport;
use analyzer::graph::Node;
use model::AnalysisResult;

use crate::paths::path;

/// Building archetypes by complexity, from the floor formula of the city
/// design: upper bound of each class, and its name.
const ARCHETYPES: &[(u32, &str)] = &[
    (3, "house"),
    (15, "small block"),
    (51, "setback block"),
    (117, "pyramid roof"),
    (u32::MAX, "tower"),
];

pub(crate) fn print_analysis(result: &AnalysisResult, elapsed: std::time::Duration) {
    let files = &result.files;
    let mut measured: Vec<(u32, usize)> = files
        .complexity
        .iter()
        .enumerate()
        .filter_map(|(row, complexity)| complexity.map(|complexity| (complexity, row)))
        .collect();
    measured.sort_unstable();
    let headers = files.header.iter().flatten().count();
    println!("analyzed in   {elapsed:.1?}");
    println!(
        "parsed        {} files, {} symbols, {} headers",
        measured.len(),
        result.symbols.name.len(),
        headers
    );
    if measured.is_empty() {
        return;
    }
    let percentile = |p: usize| measured[(measured.len() - 1) * p / 100].0;
    println!(
        "complexity    p50 {}, p90 {}, p97 {}, p99 {}, max {}",
        percentile(50),
        percentile(90),
        percentile(97),
        percentile(99),
        measured[measured.len() - 1].0
    );
    let mut lower = 0;
    let shares: Vec<String> = ARCHETYPES
        .iter()
        .map(|&(upper, name)| {
            let count = measured
                .iter()
                .filter(|&&(complexity, _)| complexity > lower && complexity <= upper)
                .count();
            lower = upper;
            format!(
                "{name} {:.1}%",
                100.0 * count as f64 / measured.len() as f64
            )
        })
        .collect();
    println!("archetypes    {}", shares.join(", "));
    let top: Vec<String> = measured
        .iter()
        .rev()
        .take(5)
        .map(|&(complexity, row)| format!("{} {complexity}", path(result, row)))
        .collect();
    println!("most complex  {}", top.join(", "));
}

/// How many unresolved modules, and undeclared packages, to list.
const UNRESOLVED_SHOWN: usize = 20;

pub(crate) fn print_imports(result: &AnalysisResult, report: &ImportReport) {
    let stats = &result.stats;
    let internal = stats.imports_total - stats.imports_external;
    let rate = if internal == 0 {
        100.0
    } else {
        100.0 * f64::from(stats.imports_resolved) / f64::from(internal)
    };
    println!(
        "imports       {} found: {} exact, {} likely, {} external, {} unresolved ({rate:.1}% of internal ones resolved)",
        stats.imports_total, report.exact, report.likely, report.external, report.unresolved
    );
    let kinds: Vec<String> = report
        .by_kind
        .iter()
        .map(|(kind, count)| format!("{kind:?} {count}").to_lowercase())
        .collect();
    println!("kinds         {}", kinds.join(", "));
    let to_dirs = result.edges.to_dir.iter().flatten().count();
    let likely = result
        .edges
        .confidence
        .iter()
        .filter(|&&confidence| confidence == model::Confidence::Likely)
        .count();
    println!(
        "edges         {} ({} to folders, {likely} likely)",
        result.edges.from.len(),
        to_dirs
    );
    for (module, count) in report.unresolved_modules.iter().take(UNRESOLVED_SHOWN) {
        println!("  unresolved  {module} ({count})");
    }
    for (package, count) in report.undeclared_packages.iter().take(UNRESOLVED_SHOWN) {
        println!("  undeclared  {package} ({count})");
    }
}

/// How many files of the fan-in tops, and edges seen through barrels, to
/// list.
const TOP_SHOWN: usize = 10;

pub(crate) fn print_graph(result: &AnalysisResult, report: &analyzer::Report) {
    let graph = &report.graph;
    let mut scopes: BTreeMap<String, usize> = BTreeMap::new();
    for scope in &result.files.scope {
        *scopes
            .entry(format!("{scope:?}").to_lowercase())
            .or_default() += 1;
    }
    let scopes: Vec<String> = scopes
        .iter()
        .map(|(scope, count)| format!("{scope} {count}"))
        .collect();
    println!("scopes        {}", scopes.join(", "));

    let files = 0..u32::try_from(graph.file_count()).unwrap_or(u32::MAX);
    let production = files
        .clone()
        .filter(|&file| graph.is_production(file))
        .count();
    let edges: Vec<(u32, &analyzer::graph::Edge)> = files
        .clone()
        .flat_map(|file| graph.production_edges(file).map(move |edge| (file, edge)))
        .collect();
    let via = edges.iter().filter(|(_, edge)| edge.via_barrel).count();
    println!(
        "production    {production} files, {} edges ({via} through barrels)",
        edges.len()
    );
    let index_files: Vec<u32> = files
        .clone()
        .filter(|&file| {
            let name = &result.files.name[file as usize];
            name.starts_with("index.") || name == "__init__.py"
        })
        .collect();
    let index_barrels = index_files
        .iter()
        .filter(|&&file| graph.is_barrel(file))
        .count();
    let barrels = &report.barrels;
    println!(
        "index files   {}, of which {index_barrels} barrels",
        index_files.len()
    );
    println!(
        "barrels       {}: {} names followed, {} missing, {} ambiguous, {} whole imports, {} lookup steps",
        barrels.barrels,
        barrels.names_through,
        barrels.names_missing,
        barrels.names_ambiguous,
        barrels.whole_imports,
        barrels.steps
    );

    let mut complete = vec![0_u32; graph.file_count()];
    for to in result.edges.to.iter().flatten() {
        complete[*to as usize] += 1;
    }
    print_top(result, "fan-in, all", &complete);
    let mut fan_in = vec![0_u32; graph.file_count()];
    for (_, edge) in &edges {
        if let Node::File(to) = edge.to {
            fan_in[to as usize] += 1;
        }
    }
    print_top(result, "fan-in, prod", &fan_in);

    let through: Vec<_> = edges.iter().filter(|(_, edge)| edge.via_barrel).collect();
    let step = (through.len() / TOP_SHOWN).max(1);
    for (from, edge) in through.iter().step_by(step).take(TOP_SHOWN) {
        if let Node::File(to) = edge.to {
            println!(
                "  through     {} -> {}",
                path(result, *from as usize),
                path(result, to as usize)
            );
        }
    }
}

/// The files with the highest counts, ties broken by path.
fn print_top(result: &AnalysisResult, label: &str, counts: &[u32]) {
    let mut ranked: Vec<(u32, usize)> = counts
        .iter()
        .enumerate()
        .filter(|&(_, &count)| count > 0)
        .map(|(file, &count)| (count, file))
        .collect();
    ranked.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    println!("{label}");
    for (count, file) in ranked.into_iter().take(TOP_SHOWN) {
        println!("  {count:>6}  {}", path(result, file));
    }
}
