//! Analysis results, stored as brotli-compressed JSON by repository, commit
//! and analyzer version. Only the latest few commits of a repository are
//! kept.

use std::io::{Read, Write};

use model::{AnalysisResult, FORMAT_VERSION, InvalidResult};
use sqlx::PgPool;

use crate::github::RepoName;

/// Brotli quality, from 0 to 11.
const QUALITY: u32 = 9;
/// Brotli window, as a power of two: the largest the format allows.
const WINDOW: u32 = 24;
/// Above this, a result is refused rather than stored: twenty times the
/// largest reference repository.
pub const MAX_STORED_BYTES: usize = 16 * 1024 * 1024;
/// Commits kept per repository when the setting is missing or not a number,
/// so a bad setting neither stops the retention nor fails every save.
const DEFAULT_KEPT_PER_REPO: i64 = 3;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("invalid result: {0}")]
    Invalid(#[from] InvalidResult),
    #[error("the result names an invalid repository")]
    RepoName,
    #[error("the result names an invalid commit SHA")]
    Sha,
    #[error("the result takes {0} bytes once compressed, above the limit")]
    TooLarge(usize),
    #[error("could not serialize the result: {0}")]
    Json(#[from] serde_json::Error),
    #[error("could not compress the result: {0}")]
    Compression(#[from] std::io::Error),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

/// A result checked and compressed, ready to store. Encoding is CPU work,
/// so an async caller runs it in `spawn_blocking`.
#[derive(Debug, Clone)]
pub struct Encoded {
    repo: RepoName,
    sha: String,
    analyzer_version: String,
    body: Vec<u8>,
    raw_size: usize,
}

impl Encoded {
    pub fn raw_size(&self) -> usize {
        self.raw_size
    }

    pub fn stored_size(&self) -> usize {
        self.body.len()
    }
}

/// Validates, serializes and compresses a result.
pub fn encode(result: &AnalysisResult) -> Result<Encoded, StoreError> {
    encode_within(result, MAX_STORED_BYTES)
}

fn encode_within(result: &AnalysisResult, max_stored_bytes: usize) -> Result<Encoded, StoreError> {
    result.validate()?;
    let repo = RepoName::parse(&format!("{}/{}", result.repo.owner, result.repo.name))
        .map_err(|_| StoreError::RepoName)?;
    // Lowercase only, as GitHub writes it, so the key matches the JSON.
    let sha_ok = result.sha.len() == 40
        && result
            .sha
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'));
    if !sha_ok {
        return Err(StoreError::Sha);
    }
    let json = serde_json::to_vec(result)?;
    let mut writer = brotli::CompressorWriter::new(Vec::new(), 64 * 1024, QUALITY, WINDOW);
    writer.write_all(&json)?;
    // Ends the stream. Writing to a Vec cannot fail.
    let body = writer.into_inner();
    if body.len() > max_stored_bytes {
        return Err(StoreError::TooLarge(body.len()));
    }
    Ok(Encoded {
        repo,
        sha: result.sha.clone(),
        analyzer_version: result.analyzer_version.clone(),
        body,
        raw_size: json.len(),
    })
}

/// The JSON of a stored body, for a client that does not accept brotli.
pub fn decompress(body: &[u8]) -> Result<Vec<u8>, std::io::Error> {
    let mut json = Vec::new();
    brotli::Decompressor::new(body, 64 * 1024).read_to_end(&mut json)?;
    Ok(json)
}

/// Stores a result, replacing the one of the same commit and analyzer
/// version, then applies the retention to its repository: only the latest
/// result of each commit, and only the latest commits, are kept. Returns
/// how many results the retention removed.
pub async fn save(pool: &PgPool, encoded: &Encoded) -> Result<u64, StoreError> {
    let mut tx = pool.begin().await?;
    // The upsert locks the repository's row, so writes to one repository
    // are applied one at a time.
    let repo_id = sqlx::query_scalar!(
        r#"
        INSERT INTO repos (owner, name) VALUES ($1, $2)
        ON CONFLICT (lower(owner), lower(name))
        DO UPDATE SET owner = EXCLUDED.owner, name = EXCLUDED.name
        RETURNING id
        "#,
        encoded.repo.owner(),
        encoded.repo.name(),
    )
    .fetch_one(&mut *tx)
    .await?;
    // The clock, not the start of the transaction, which may be older than
    // a write that took the lock first.
    sqlx::query!(
        r#"
        INSERT INTO results
            (repo_id, sha, analyzer_version, format_version, body, raw_size, stored_size, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, clock_timestamp())
        ON CONFLICT (repo_id, sha, analyzer_version) DO UPDATE SET
            format_version = EXCLUDED.format_version,
            body = EXCLUDED.body,
            raw_size = EXCLUDED.raw_size,
            stored_size = EXCLUDED.stored_size,
            created_at = EXCLUDED.created_at
        "#,
        repo_id,
        encoded.sha,
        encoded.analyzer_version,
        format_version(),
        encoded.body,
        size(encoded.raw_size),
        size(encoded.body.len()),
    )
    .execute(&mut *tx)
    .await?;
    let removed = sqlx::query!(
        r#"
        DELETE FROM results
        WHERE repo_id = $1
          AND (format_version <> $2 OR id NOT IN (
              SELECT id FROM (
                  SELECT DISTINCT ON (sha) id, created_at
                  FROM results
                  WHERE repo_id = $1 AND format_version = $2
                  ORDER BY sha, created_at DESC, id DESC
              ) AS newest
              ORDER BY created_at DESC, id DESC
              LIMIT COALESCE((
                  SELECT GREATEST(1, LEAST(floor(value::numeric), 1000))::bigint
                  FROM settings
                  WHERE key = 'results_kept_per_repo' AND jsonb_typeof(value) = 'number'
              ), $3)
          ))
        "#,
        repo_id,
        format_version(),
        DEFAULT_KEPT_PER_REPO,
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    tx.commit().await?;
    Ok(removed)
}

/// A stored result, its body still compressed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Stored {
    pub sha: String,
    pub analyzer_version: String,
    pub body: Vec<u8>,
}

/// The result of this commit by the running analyzer, if any.
pub async fn find(pool: &PgPool, repo: &RepoName, sha: &str) -> Result<Option<Stored>, StoreError> {
    let stored = sqlx::query_as!(
        Stored,
        r#"
        SELECT results.sha, results.analyzer_version, results.body
        FROM results JOIN repos ON repos.id = results.repo_id
        WHERE lower(repos.owner) = lower($1) AND lower(repos.name) = lower($2)
          AND results.sha = lower($3)
          AND results.analyzer_version = $4
          AND results.format_version = $5
        "#,
        repo.owner(),
        repo.name(),
        sha,
        analyzer::ANALYZER_VERSION,
        format_version(),
    )
    .fetch_optional(pool)
    .await?;
    Ok(stored)
}

/// The latest result of a repository the web app can read, whatever its
/// commit and analyzer version: an older city to show while offering to
/// rebuild it.
pub async fn latest(pool: &PgPool, repo: &RepoName) -> Result<Option<Stored>, StoreError> {
    let stored = sqlx::query_as!(
        Stored,
        r#"
        SELECT results.sha, results.analyzer_version, results.body
        FROM results JOIN repos ON repos.id = results.repo_id
        WHERE lower(repos.owner) = lower($1) AND lower(repos.name) = lower($2)
          AND results.format_version = $3
        ORDER BY results.created_at DESC, results.id DESC
        LIMIT 1
        "#,
        repo.owner(),
        repo.name(),
        format_version(),
    )
    .fetch_optional(pool)
    .await?;
    Ok(stored)
}

/// Removes every result of one commit. Returns how many were removed.
pub async fn purge_commit(pool: &PgPool, repo: &RepoName, sha: &str) -> Result<u64, StoreError> {
    let removed = sqlx::query!(
        r#"
        DELETE FROM results USING repos
        WHERE repos.id = results.repo_id
          AND lower(repos.owner) = lower($1) AND lower(repos.name) = lower($2)
          AND results.sha = lower($3)
        "#,
        repo.owner(),
        repo.name(),
        sha,
    )
    .execute(pool)
    .await?
    .rows_affected();
    Ok(removed)
}

/// Removes a repository and all its results. Returns whether it was stored.
pub async fn purge_repo(pool: &PgPool, repo: &RepoName) -> Result<bool, StoreError> {
    let removed = sqlx::query!(
        "DELETE FROM repos WHERE lower(owner) = lower($1) AND lower(name) = lower($2)",
        repo.owner(),
        repo.name(),
    )
    .execute(pool)
    .await?
    .rows_affected();
    Ok(removed > 0)
}

/// What the stored results weigh.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Usage {
    pub results: i64,
    /// Compressed bytes of all results.
    pub stored_bytes: i64,
    /// Everything the database takes on disk, indexes and overhead included.
    pub database_bytes: i64,
}

pub async fn usage(pool: &PgPool) -> Result<Usage, StoreError> {
    let usage = sqlx::query_as!(
        Usage,
        r#"
        SELECT
            count(*) AS "results!",
            coalesce(sum(stored_size), 0)::bigint AS "stored_bytes!",
            pg_database_size(current_database()) AS "database_bytes!"
        FROM results
        "#,
    )
    .fetch_one(pool)
    .await?;
    Ok(usage)
}

const _: () = assert!(FORMAT_VERSION <= i32::MAX as u32);

fn format_version() -> i32 {
    FORMAT_VERSION as i32
}

fn size(bytes: usize) -> i64 {
    // A result is held in memory, so its size is far below i64::MAX.
    i64::try_from(bytes).unwrap_or(i64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> AnalysisResult {
        serde_json::from_str(include_str!(
            "../../../../web/src/data/generated/sample-result.json"
        ))
        .unwrap()
    }

    #[test]
    fn a_result_survives_encoding() {
        let result = sample();
        let encoded = encode(&result).unwrap();
        assert!(encoded.stored_size() < encoded.raw_size());
        let json = decompress(&encoded.body).unwrap();
        assert_eq!(json.len(), encoded.raw_size());
        let decoded: AnalysisResult = serde_json::from_slice(&json).unwrap();
        assert_eq!(decoded, result);
    }

    #[test]
    fn an_invalid_result_is_refused() {
        let mut result = sample();
        result.format_version = FORMAT_VERSION - 1;
        assert!(matches!(encode(&result), Err(StoreError::Invalid(_))));
    }

    #[test]
    fn a_result_must_name_a_github_repository() {
        let mut result = sample();
        result.repo.owner = "not an owner".into();
        assert!(matches!(encode(&result), Err(StoreError::RepoName)));
    }

    #[test]
    fn a_result_must_name_a_lowercase_commit_sha() {
        for sha in ["", "abc123", &"G".repeat(40), &"A".repeat(40)] {
            let mut result = sample();
            result.sha = sha.to_owned();
            assert!(matches!(encode(&result), Err(StoreError::Sha)), "{sha}");
        }
    }

    #[test]
    fn a_result_too_large_once_compressed_is_refused() {
        let result = sample();
        let size = encode(&result).unwrap().stored_size();
        assert!(encode_within(&result, size).is_ok());
        assert!(matches!(
            encode_within(&result, size - 1),
            Err(StoreError::TooLarge(actual)) if actual == size
        ));
    }
}
