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
mod expected;
mod layout;
mod paths;
mod roles;
mod structure;

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
use expected::Expected;
use layout::print_layout;
use roles::print_roles;
use structure::print_structure;

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
