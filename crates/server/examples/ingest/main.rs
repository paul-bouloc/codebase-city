//! Ingests and analyzes a real repository, and prints what came out, to
//! check the filters, limits and measures by hand: `just ingest owner/repo`,
//! plus `--out result.json` to write the result, and `--expect file` to
//! compare the roles with what a person expects (`entries: [a, b]`,
//! `foundations: […]`, `conductors: […]`, one list per line; a Go package
//! ends with `/`, and the one at the root is `/`), and the layers of the
//! islands (`layers: [a, [b, c], d]`, from the bottom up, islands of one
//! layer in brackets). `--store` saves the result in the database of
//! `DATABASE_URL`, retention included, without applying migrations.
//!
//! Given a result written by `--out` instead of a repository, lays it out
//! again with the current code and prints the layout, without downloading
//! anything: `just ingest result.json [--out result.json]`.
//!
//! `--archive repo.tar.gz` reads a local gzipped tarball instead of
//! downloading one, for a copy GitHub would not serve: every file under one
//! top folder, as `git archive --prefix=repo/ HEAD | gzip` makes it. The
//! commit is then forty zeros.
//!
//! Uses `GITHUB_TOKEN` when set, and GitHub anonymously otherwise.

mod analysis;
mod layout;
mod paths;

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use anyhow::Context;
use model::{AnalysisResult, Repo};
use server::github::{GithubClient, RepoName, Token};
use server::ingest::{Ingested, Limits, Progress, ingest, ingest_archive};
use server::store::results;

use analysis::{print_analysis, print_graph, print_imports};
use layout::print_layout;
use paths::{dir_path, path, target};

const MB: f64 = 1024.0 * 1024.0;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    const USAGE: &str = "usage: ingest owner/repo|result.json [--out result.json] [--expect roles.yaml] [--archive repo.tar.gz] [--store]";
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some((name, flags)) = args.split_first() else {
        anyhow::bail!(USAGE);
    };
    let mut out = None;
    let mut expected = None;
    let mut archive = None;
    let mut store = false;
    let mut flags = flags.iter();
    while let Some(flag) = flags.next() {
        match flag.as_str() {
            "--store" => store = true,
            "--out" | "--expect" | "--archive" => {
                let Some(path) = flags.next().filter(|path| !path.starts_with("--")) else {
                    anyhow::bail!(USAGE);
                };
                if flag == "--out" {
                    out = Some(PathBuf::from(path));
                } else if flag == "--archive" {
                    archive = Some(PathBuf::from(path));
                } else {
                    let text =
                        std::fs::read_to_string(path).with_context(|| format!("reading {path}"))?;
                    expected = Some(Expected::parse(&text));
                }
            }
            _ => anyhow::bail!(USAGE),
        }
    }
    if name.ends_with(".json") {
        let text = std::fs::read_to_string(name).with_context(|| format!("reading {name}"))?;
        let mut result: AnalysisResult = serde_json::from_str(&text)?;
        // Laying out an inconsistent result would index out of bounds: validate it first.
        result.validate()?;
        result.layout = analyzer::layout::of_result(&result);
        result.validate()?;
        print_layout(&result);
        if let Some(out) = out {
            std::fs::write(&out, serde_json::to_vec(&result)?)
                .with_context(|| format!("writing {}", out.display()))?;
        }
        return Ok(());
    }
    let repo = RepoName::parse(name)?;
    let (sha, ingested, elapsed) = match archive {
        Some(path) => {
            let file = std::fs::File::open(&path)
                .with_context(|| format!("opening {}", path.display()))?;
            let bytes = file.metadata()?.len();
            let started = Instant::now();
            let ingested = tokio::task::spawn_blocking(move || {
                ingest_archive(
                    std::io::BufReader::new(file),
                    bytes,
                    &Limits::default(),
                    &|_| {},
                )
            })
            .await??;
            ("0".repeat(40), ingested, started.elapsed())
        }
        None => download(&repo).await?,
    };

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
        "ignored       {} vendored, {} minified, {} binary, {} too deep",
        ingested.ignored.vendored,
        ingested.ignored.minified,
        ingested.ignored.binary,
        ingested.ignored.deep
    );
    let top: Vec<String> = languages
        .iter()
        .take(8)
        .map(|(name, count)| format!("{name} {count}"))
        .collect();
    println!("languages     {}", top.join(", "));

    let repo = Repo {
        owner: repo.owner().to_owned(),
        name: repo.name().to_owned(),
    };
    let started = Instant::now();
    let (result, report) = tokio::task::spawn_blocking(move || {
        analyzer::analyze_with_report(repo, sha, ingested.files, ingested.ignored)
    })
    .await?;
    let elapsed = started.elapsed();
    result.validate()?;
    print_analysis(&result, elapsed);
    print_imports(&result, &report.imports);
    print_graph(&result, &report);
    print_roles(&result, &report.roles, expected.as_ref());
    print_structure(&result, expected.as_ref());
    print_layout(&result);

    let started = Instant::now();
    let (result, encoded) = tokio::task::spawn_blocking(move || {
        let encoded = results::encode(&result);
        (result, encoded)
    })
    .await?;
    let encoded = encoded?;
    println!(
        "result        {:.1} MB JSON, {:.2} MB brotli in {:.2?}",
        encoded.raw_size() as f64 / MB,
        encoded.stored_size() as f64 / MB,
        started.elapsed()
    );
    if store {
        let url = std::env::var("DATABASE_URL").context("--store needs DATABASE_URL")?;
        // No migrations from a tool that may point anywhere: the server
        // applies them.
        let pool = sqlx::PgPool::connect(&url).await?;
        let removed = results::save(&pool, &encoded).await.context(
            "saving the result (the server applies the migrations: run `just serve` once)",
        )?;
        println!("stored        {removed} older results removed by the retention");
    }
    if let Some(path) = out {
        let json = serde_json::to_vec(&result)?;
        std::fs::write(&path, &json).with_context(|| format!("writing {}", path.display()))?;
        println!("written to    {}", path.display());
    }
    Ok(())
}

/// Downloads and reads the default branch of `repo` from GitHub: its
/// commit, what came out, and how long that took.
async fn download(repo: &RepoName) -> anyhow::Result<(String, Ingested, Duration)> {
    let token = std::env::var("GITHUB_TOKEN")
        .ok()
        .filter(|token| !token.is_empty())
        .map(Token::new);
    let client = GithubClient::new(token)?;

    let started = Instant::now();
    let snapshot = client.resolve(repo).await?;
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
    Ok((snapshot.sha, ingested, started.elapsed()))
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
