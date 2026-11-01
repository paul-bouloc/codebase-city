//! Ingests and analyzes a real repository, and prints what came out, to
//! check the filters, limits and measures by hand: `just ingest owner/repo`,
//! plus `--out result.json` to write the result.
//!
//! Uses `GITHUB_TOKEN` when set, and GitHub anonymously otherwise.

use std::collections::BTreeMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use analyzer::ImportReport;
use anyhow::Context;
use flate2::Compression;
use flate2::write::GzEncoder;
use model::{AnalysisResult, Repo};
use server::github::{GithubClient, RepoName, Token};
use server::ingest::{Limits, Progress, ingest};

const MB: f64 = 1024.0 * 1024.0;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    const USAGE: &str = "usage: ingest owner/repo [--out result.json]";
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (name, out) = match args.as_slice() {
        [name] => (name, None),
        [name, flag, path] if flag == "--out" => (name, Some(PathBuf::from(path))),
        _ => anyhow::bail!(USAGE),
    };
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
    print_imports(&result, &report);

    let json = serde_json::to_vec(&result)?;
    let mut gzip = GzEncoder::new(Vec::new(), Compression::default());
    gzip.write_all(&json)?;
    let gzipped = gzip.finish()?;
    println!(
        "result        {:.1} MB JSON, {:.2} MB gzip",
        json.len() as f64 / MB,
        gzipped.len() as f64 / MB
    );
    if let Some(path) = out {
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
