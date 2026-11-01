//! Stored results, against a real Postgres (`just db-up`): each test gets a
//! fresh database with the migrations applied.

#![allow(clippy::unwrap_used)]

use model::{AnalysisResult, FORMAT_VERSION};
use server::github::RepoName;
use server::store::results::{
    Stored, decompress, encode, find, latest, purge_commit, purge_repo, save, usage,
};
use sqlx::PgPool;

const CURRENT: &str = analyzer::ANALYZER_VERSION;

fn sha(n: u8) -> String {
    format!("{n:02x}").repeat(20)
}

fn result(owner: &str, sha: &str, analyzer_version: &str) -> AnalysisResult {
    let mut result: AnalysisResult = serde_json::from_str(include_str!(
        "../../../web/src/data/generated/sample-result.json"
    ))
    .unwrap();
    result.repo.owner = owner.to_owned();
    result.repo.name = "harbor".to_owned();
    result.sha = sha.to_owned();
    result.analyzer_version = analyzer_version.to_owned();
    result
}

async fn store(pool: &PgPool, owner: &str, sha: &str, analyzer_version: &str) -> u64 {
    save(
        pool,
        &encode(&result(owner, sha, analyzer_version)).unwrap(),
    )
    .await
    .unwrap()
}

fn harbor() -> RepoName {
    RepoName::parse("acme/harbor").unwrap()
}

/// The commit and analyzer version of every stored result, latest first.
async fn shas(pool: &PgPool) -> Vec<(String, String)> {
    sqlx::query_as("SELECT sha, analyzer_version FROM results ORDER BY created_at DESC, id DESC")
        .fetch_all(pool)
        .await
        .unwrap()
}

#[sqlx::test(migrator = "server::store::MIGRATOR")]
async fn a_stored_result_reads_back_unchanged(pool: PgPool) {
    let original = result("acme", &sha(1), CURRENT);
    save(&pool, &encode(&original).unwrap()).await.unwrap();

    let stored = find(&pool, &harbor(), &sha(1)).await.unwrap().unwrap();
    assert_eq!(stored.sha, sha(1));
    assert_eq!(stored.analyzer_version, CURRENT);
    let decoded: AnalysisResult =
        serde_json::from_slice(&decompress(&stored.body).unwrap()).unwrap();
    assert_eq!(decoded, original);
}

#[sqlx::test(migrator = "server::store::MIGRATOR")]
async fn find_wants_the_same_commit_and_analyzer_version(pool: PgPool) {
    store(&pool, "acme", &sha(1), "0.0.1").await;
    store(&pool, "acme", &sha(2), CURRENT).await;

    assert_eq!(find(&pool, &harbor(), &sha(1)).await.unwrap(), None);
    assert_eq!(find(&pool, &harbor(), &sha(3)).await.unwrap(), None);
    let other = RepoName::parse("acme/other").unwrap();
    assert_eq!(find(&pool, &other, &sha(2)).await.unwrap(), None);
    assert!(find(&pool, &harbor(), &sha(2)).await.unwrap().is_some());
}

#[sqlx::test(migrator = "server::store::MIGRATOR")]
async fn names_are_matched_whatever_their_case(pool: PgPool) {
    store(&pool, "Acme", &sha(1), CURRENT).await;
    let shouted = RepoName::parse("ACME/Harbor").unwrap();
    assert!(find(&pool, &shouted, &sha(1)).await.unwrap().is_some());
    assert!(latest(&pool, &shouted).await.unwrap().is_some());

    // One repository, named as GitHub last spelled it.
    store(&pool, "acme", &sha(2), CURRENT).await;
    let repos: Vec<(String,)> = sqlx::query_as("SELECT owner FROM repos")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(repos, [("acme".to_owned(),)]);
}

#[sqlx::test(migrator = "server::store::MIGRATOR")]
async fn storing_the_same_key_again_replaces_it(pool: PgPool) {
    store(&pool, "acme", &sha(1), CURRENT).await;
    store(&pool, "acme", &sha(2), CURRENT).await;
    store(&pool, "acme", &sha(1), CURRENT).await;

    assert_eq!(
        shas(&pool).await,
        [(sha(1), CURRENT.to_owned()), (sha(2), CURRENT.to_owned())]
    );
}

#[sqlx::test(migrator = "server::store::MIGRATOR")]
async fn latest_serves_an_older_analyzer_version_of_the_same_format(pool: PgPool) {
    assert_eq!(latest(&pool, &harbor()).await.unwrap(), None);
    store(&pool, "acme", &sha(1), CURRENT).await;
    store(&pool, "acme", &sha(2), "0.0.1").await;

    let Stored {
        sha: latest_sha,
        analyzer_version,
        ..
    } = latest(&pool, &harbor()).await.unwrap().unwrap();
    assert_eq!((latest_sha, analyzer_version.as_str()), (sha(2), "0.0.1"));
}

#[sqlx::test(migrator = "server::store::MIGRATOR")]
async fn a_result_of_another_format_is_never_served_and_goes_at_the_next_save(pool: PgPool) {
    store(&pool, "acme", &sha(1), CURRENT).await;
    sqlx::query("UPDATE results SET format_version = $1")
        .bind(i32::try_from(FORMAT_VERSION).unwrap() - 1)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(find(&pool, &harbor(), &sha(1)).await.unwrap(), None);
    assert_eq!(latest(&pool, &harbor()).await.unwrap(), None);

    assert_eq!(store(&pool, "acme", &sha(2), CURRENT).await, 1);
    assert_eq!(shas(&pool).await, [(sha(2), CURRENT.to_owned())]);
}

#[sqlx::test(migrator = "server::store::MIGRATOR")]
async fn the_latest_three_commits_are_kept(pool: PgPool) {
    for n in 1..=3 {
        assert_eq!(store(&pool, "acme", &sha(n), CURRENT).await, 0);
    }
    // Another repository is left alone.
    store(&pool, "other", &sha(9), CURRENT).await;

    assert_eq!(store(&pool, "acme", &sha(4), CURRENT).await, 1);
    let kept: Vec<String> = shas(&pool).await.into_iter().map(|(sha, _)| sha).collect();
    assert_eq!(kept, [sha(4), sha(9), sha(3), sha(2)]);
}

#[sqlx::test(migrator = "server::store::MIGRATOR")]
async fn a_commit_keeps_only_its_latest_analysis(pool: PgPool) {
    store(&pool, "acme", &sha(1), "0.0.1").await;
    store(&pool, "acme", &sha(2), CURRENT).await;

    assert_eq!(store(&pool, "acme", &sha(1), CURRENT).await, 1);
    assert_eq!(
        shas(&pool).await,
        [(sha(1), CURRENT.to_owned()), (sha(2), CURRENT.to_owned())]
    );
}

#[sqlx::test(migrator = "server::store::MIGRATOR")]
async fn the_number_of_commits_kept_is_a_setting(pool: PgPool) {
    sqlx::query("UPDATE settings SET value = '1' WHERE key = 'results_kept_per_repo'")
        .execute(&pool)
        .await
        .unwrap();
    store(&pool, "acme", &sha(1), CURRENT).await;
    assert_eq!(store(&pool, "acme", &sha(2), CURRENT).await, 1);
    assert_eq!(shas(&pool).await, [(sha(2), CURRENT.to_owned())]);

    // Zero would remove what was just stored: one is the floor.
    sqlx::query("UPDATE settings SET value = '0' WHERE key = 'results_kept_per_repo'")
        .execute(&pool)
        .await
        .unwrap();
    store(&pool, "acme", &sha(3), CURRENT).await;
    assert_eq!(shas(&pool).await, [(sha(3), CURRENT.to_owned())]);

    // A fraction is rounded down.
    sqlx::query("UPDATE settings SET value = '2.7' WHERE key = 'results_kept_per_repo'")
        .execute(&pool)
        .await
        .unwrap();
    for n in 4..=5 {
        store(&pool, "acme", &sha(n), CURRENT).await;
    }
    assert_eq!(shas(&pool).await.len(), 2);
}

/// Stores five commits and returns how many are kept.
async fn kept_after_five(pool: &PgPool) -> usize {
    for n in 1..=5 {
        store(pool, "acme", &sha(n), CURRENT).await;
    }
    shas(pool).await.len()
}

#[sqlx::test(migrator = "server::store::MIGRATOR")]
async fn a_missing_setting_keeps_three_commits(pool: PgPool) {
    sqlx::query("DELETE FROM settings")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(kept_after_five(&pool).await, 3);
}

#[sqlx::test(migrator = "server::store::MIGRATOR")]
async fn a_setting_that_is_not_a_number_keeps_three_commits(pool: PgPool) {
    for value in [r#""three""#, r#""2""#, "null", "true", "[1]"] {
        sqlx::query("UPDATE settings SET value = $1::jsonb WHERE key = 'results_kept_per_repo'")
            .bind(value)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM results")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(kept_after_five(&pool).await, 3, "{value}");
    }
}

#[sqlx::test(migrator = "server::store::MIGRATOR")]
async fn a_huge_setting_does_not_fail_the_save(pool: PgPool) {
    sqlx::query("UPDATE settings SET value = '1e30' WHERE key = 'results_kept_per_repo'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(kept_after_five(&pool).await, 5);
}

#[sqlx::test(migrator = "server::store::MIGRATOR")]
async fn a_commit_can_be_purged(pool: PgPool) {
    store(&pool, "acme", &sha(1), "0.0.1").await;
    store(&pool, "acme", &sha(2), CURRENT).await;
    store(&pool, "other", &sha(1), CURRENT).await;

    assert_eq!(purge_commit(&pool, &harbor(), &sha(1)).await.unwrap(), 1);
    assert_eq!(purge_commit(&pool, &harbor(), &sha(1)).await.unwrap(), 0);
    assert_eq!(
        shas(&pool).await,
        [(sha(1), CURRENT.to_owned()), (sha(2), CURRENT.to_owned())]
    );
}

#[sqlx::test(migrator = "server::store::MIGRATOR")]
async fn a_repository_can_be_purged(pool: PgPool) {
    store(&pool, "acme", &sha(1), CURRENT).await;
    store(&pool, "acme", &sha(2), CURRENT).await;
    store(&pool, "other", &sha(3), CURRENT).await;

    assert!(purge_repo(&pool, &harbor()).await.unwrap());
    assert!(!purge_repo(&pool, &harbor()).await.unwrap());
    assert_eq!(shas(&pool).await, [(sha(3), CURRENT.to_owned())]);
}

#[sqlx::test(migrator = "server::store::MIGRATOR")]
async fn usage_counts_results_and_bytes(pool: PgPool) {
    let empty = usage(&pool).await.unwrap();
    assert_eq!((empty.results, empty.stored_bytes), (0, 0));
    assert!(empty.database_bytes > 0);

    let mut bytes = 0;
    for owner in ["acme", "other"] {
        let encoded = encode(&result(owner, &sha(1), CURRENT)).unwrap();
        save(&pool, &encoded).await.unwrap();
        bytes += encoded.stored_size() as i64;
    }
    let used = usage(&pool).await.unwrap();
    assert_eq!(used.results, 2);
    assert_eq!(used.stored_bytes, bytes);
}

#[sqlx::test(migrator = "server::store::MIGRATOR")]
async fn concurrent_saves_to_one_repository_keep_the_retention(pool: PgPool) {
    sqlx::query("UPDATE settings SET value = '2' WHERE key = 'results_kept_per_repo'")
        .execute(&pool)
        .await
        .unwrap();
    let saves: Vec<_> = (1..=16)
        .map(|n| {
            let pool = pool.clone();
            tokio::spawn(async move { store(&pool, "acme", &sha(n), CURRENT).await })
        })
        .collect();
    for save in saves {
        save.await.unwrap();
    }
    assert_eq!(shas(&pool).await.len(), 2);
}

#[sqlx::test(migrator = "server::store::MIGRATOR")]
async fn the_body_is_not_compressed_twice(pool: PgPool) {
    let storage: i8 = sqlx::query_scalar(
        "SELECT attstorage FROM pg_attribute WHERE attrelid = 'results'::regclass AND attname = 'body'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(storage as u8, b'e');
}
