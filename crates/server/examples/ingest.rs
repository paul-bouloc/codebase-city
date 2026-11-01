//! Ingests and analyzes a real repository, and prints what came out, to
//! check the filters, limits and measures by hand: `just ingest owner/repo`,
//! plus `--out result.json` to write the result, and `--expect file` to
//! compare the roles with what a person expects (`entries: [a, b]`,
//! `foundations: […]`, `conductors: […]`, one list per line; a Go package
//! ends with `/`, and the one at the root is `/`), and the layers of the
//! islands (`layers: [a, [b, c], d]`, from the bottom up, islands of one
//! layer in brackets). `--store` saves the result in the database of
//! `DATABASE_URL`, retention included.
//!
//! Uses `GITHUB_TOKEN` when set, and GitHub anonymously otherwise.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use analyzer::ImportReport;
use analyzer::graph::Node;
use anyhow::Context;
use model::{AnalysisResult, Repo};
use server::github::{GithubClient, RepoName, Token};
use server::ingest::{Limits, Progress, ingest};
use server::store::results;

const MB: f64 = 1024.0 * 1024.0;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    const USAGE: &str =
        "usage: ingest owner/repo [--out result.json] [--expect roles.yaml] [--store]";
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some((name, flags)) = args.split_first() else {
        anyhow::bail!(USAGE);
    };
    let mut out = None;
    let mut expected = None;
    let mut store = false;
    let mut flags = flags.iter();
    while let Some(flag) = flags.next() {
        match (flag.as_str(), flags.clone().next()) {
            ("--store", _) => store = true,
            ("--out", Some(path)) => {
                out = Some(PathBuf::from(path));
                flags.next();
            }
            ("--expect", Some(path)) => {
                let text =
                    std::fs::read_to_string(path).with_context(|| format!("reading {path}"))?;
                expected = Some(Expected::parse(&text));
                flags.next();
            }
            _ => anyhow::bail!(USAGE),
        }
    }
    let repo = RepoName::parse(name)?;
    let token = std::env::var("GITHUB_TOKEN")
        .ok()
        .filter(|token| !token.is_empty())
        .map(Token::new);
    let client = GithubClient::new(token)?;

    let started = Instant::now();
    let snapshot = client.resolve(&repo).await?;
    let resolved = started.elapsed();
    eprintln!(
        "{} @ {} ({}), resolved in {resolved:.1?}",
        snapshot.repo, snapshot.sha, snapshot.default_branch
    );

    let last_megabyte = Arc::new(AtomicU64::new(0));
    let on_progress = Arc::new(move |progress| match progress {
        Progress::WaitingForGithub(wait) => eprintln!("rate limited, waiting {wait:.0?}"),
        Progress::Downloading { bytes } => {
            let tens = bytes / (10 * 1024 * 1024);
            if last_megabyte.swap(tens, Ordering::Relaxed) != tens {
                eprintln!("downloaded {} MB", tens * 10);
            }
        }
        Progress::Reading { .. } => {}
    });
    let started = Instant::now();
    let ingested = ingest(
        &client,
        &snapshot.repo,
        &snapshot.sha,
        &Limits::default(),
        on_progress,
    )
    .await?;
    let elapsed = started.elapsed();

    let with_content = ingested
        .files
        .iter()
        .filter(|file| file.content.is_some())
        .count();
    let generated = ingested.files.iter().filter(|file| file.generated).count();
    let lines: u64 = ingested
        .files
        .iter()
        .map(|file| u64::from(file.lines))
        .sum();
    let mut languages = BTreeMap::<&str, usize>::new();
    for file in &ingested.files {
        *languages.entry(file.language.name()).or_default() += 1;
    }
    let mut languages: Vec<_> = languages.into_iter().collect();
    languages.sort_by_key(|&(_, count)| std::cmp::Reverse(count));

    println!("ingested in   {elapsed:.1?}");
    println!(
        "archive       {:.1} MB, {:.1} MB unpacked",
        ingested.archive_bytes as f64 / MB,
        ingested.unpacked_bytes as f64 / MB
    );
    println!(
        "files         {} ({} generated), {lines} lines",
        ingested.files.len(),
        generated
    );
    println!(
        "content kept  {with_content} files, {:.1} MB",
        ingested.kept_bytes as f64 / MB
    );
    println!(
        "ignored       {} vendored, {} minified, {} binary",
        ingested.ignored.vendored, ingested.ignored.minified, ingested.ignored.binary
    );
    let top: Vec<String> = languages
        .iter()
        .take(8)
        .map(|(name, count)| format!("{name} {count}"))
        .collect();
    println!("languages     {}", top.join(", "));

    let repo = Repo {
        owner: snapshot.repo.owner().to_owned(),
        name: snapshot.repo.name().to_owned(),
    };
    let started = Instant::now();
    let (result, report) = tokio::task::spawn_blocking(move || {
        analyzer::analyze_with_report(repo, snapshot.sha, ingested.files, ingested.ignored)
    })
    .await?;
    let elapsed = started.elapsed();
    result.validate()?;
    print_analysis(&result, elapsed);
    print_imports(&result, &report.imports);
    print_graph(&result, &report);
    print_roles(&result, &report.roles, expected.as_ref());
    print_structure(&result, expected.as_ref());

    let started = Instant::now();
    let encoded = results::encode(&result)?;
    println!(
        "result        {:.1} MB JSON, {:.2} MB brotli in {:.2?}",
        encoded.raw_size() as f64 / MB,
        encoded.stored_size() as f64 / MB,
        started.elapsed()
    );
    if store {
        let url = std::env::var("DATABASE_URL").context("--store needs DATABASE_URL")?;
        let pool = server::store::connect(&url).await?;
        let removed = results::save(&pool, &encoded).await?;
        println!("stored        {removed} older results removed by the retention");
    }
    if let Some(path) = out {
        let json = serde_json::to_vec(&result)?;
        std::fs::write(&path, &json).with_context(|| format!("writing {}", path.display()))?;
        println!("written to    {}", path.display());
    }
    Ok(())
}

/// The path of a file, rebuilt from the folder table.
fn path(result: &AnalysisResult, file: usize) -> String {
    let mut parts = vec![result.files.name[file].as_str()];
    let mut dir = result.files.dir[file] as usize;
    while let Some(parent) = result.dirs.parent[dir] {
        parts.push(&result.dirs.name[dir]);
        dir = parent as usize;
    }
    parts.reverse();
    parts.join("/")
}

/// Building archetypes by complexity, from the floor formula of the city
/// design: upper bound of each class, and its name.
const ARCHETYPES: &[(u32, &str)] = &[
    (3, "house"),
    (15, "small block"),
    (51, "setback block"),
    (117, "pyramid roof"),
    (u32::MAX, "tower"),
];

fn print_analysis(result: &AnalysisResult, elapsed: std::time::Duration) {
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

fn print_imports(result: &AnalysisResult, report: &ImportReport) {
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

fn print_graph(result: &AnalysisResult, report: &analyzer::Report) {
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

/// Roles a person expects, by path; a Go package's path ends with `/`.
#[derive(Default)]
struct Expected {
    entries: Vec<String>,
    foundations: Vec<String>,
    conductors: Vec<String>,
    /// Islands by path, layer by layer from the bottom.
    layers: Vec<Vec<String>>,
}

impl Expected {
    /// Reads `key: [a, b]` lines; anything else is ignored, comments too.
    fn parse(text: &str) -> Self {
        let mut expected = Self::default();
        for line in text.lines() {
            let Some((key, list)) = line.split_once(':') else {
                continue;
            };
            let list = list.split('#').next().unwrap_or_default().trim();
            if key.trim() == "layers" {
                expected.layers = parse_layers(list);
                continue;
            }
            let Some(list) = list
                .strip_prefix('[')
                .and_then(|list| list.strip_suffix(']'))
            else {
                continue;
            };
            let paths: Vec<String> = list
                .split(',')
                .map(|path| {
                    path.trim()
                        .trim_matches(|c| c == '"' || c == '\'')
                        .to_owned()
                })
                .filter(|path| !path.is_empty())
                .collect();
            match key.trim() {
                "entries" => expected.entries = paths,
                "foundations" => expected.foundations = paths,
                "conductors" => expected.conductors = paths,
                _ => {}
            }
        }
        expected
    }
}

/// `[a, [b, c], d]`: one layer per item, a bracketed item being several
/// islands of the same layer.
fn parse_layers(list: &str) -> Vec<Vec<String>> {
    let inner = list
        .strip_prefix('[')
        .and_then(|list| list.strip_suffix(']'))
        .unwrap_or_default();
    let mut layers = Vec::new();
    let mut current: Option<Vec<String>> = None;
    for token in inner.split(',') {
        let token = token.trim();
        let opens = token.starts_with('[');
        let closes = token.ends_with(']');
        let path = token
            .trim_matches(|c| c == '[' || c == ']')
            .trim()
            .to_owned();
        match (&mut current, opens) {
            (Some(group), _) => group.push(path),
            (None, true) => current = Some(vec![path]),
            (None, false) if !path.is_empty() => layers.push(vec![path]),
            (None, false) => {}
        }
        if closes && let Some(group) = current.take() {
            layers.push(group);
        }
    }
    layers
}

/// How many islands to list, the largest first, and upward links and
/// cycles.
const STRUCTURE_SHOWN: usize = 12;

fn print_structure(result: &AnalysisResult, expected: Option<&Expected>) {
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
    let mut upward: Vec<(u32, usize)> = Vec::new();
    for row in 0..links.from.len() {
        if layer_of(links.from[row]).is_some() && layer_of(links.to[row]).is_some() {
            between += links.imports[row];
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

/// The path of a folder, rebuilt from the folder table, with a final `/`.
fn dir_path(result: &AnalysisResult, dir: u32) -> String {
    let mut parts = Vec::new();
    let mut current = dir as usize;
    while let Some(parent) = result.dirs.parent[current] {
        parts.push(result.dirs.name[current].as_str());
        current = parent as usize;
    }
    parts.reverse();
    format!("{}/", parts.join("/"))
}

fn target(result: &AnalysisResult, file: Option<u32>, dir: Option<u32>) -> String {
    match (file, dir) {
        (Some(file), _) => path(result, file as usize),
        (_, Some(dir)) => dir_path(result, dir),
        _ => String::new(),
    }
}

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

fn print_roles(
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
