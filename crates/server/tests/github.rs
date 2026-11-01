//! The GitHub client against a local fake: no network.

// Test helpers are not `#[test]` functions, so clippy.toml does not cover them.
#![allow(clippy::unwrap_used)]

#[path = "support/fake_github.rs"]
mod fake_github;

use std::sync::Mutex;
use std::time::Duration;

use fake_github::{FakeGithub, Reply, SHA, repo, tarball, tarball_path};
use server::github::{Endpoints, GithubClient, GithubError, RepoName};

const REPO_JSON: &str = include_str!("fixtures/github/repo.json");

fn sha_reply() -> Reply {
    Reply::Text {
        status: 200,
        content_type: "application/vnd.github.sha; charset=utf-8",
        body: SHA.to_owned(),
        headers: Vec::new(),
    }
}

fn no_wait(_: Duration) {}

#[tokio::test]
async fn resolving_finds_the_last_commit_under_the_canonical_name() {
    let github = FakeGithub::start().await;
    github.on(
        "/repos/ExpressJS/Express",
        [Reply::Json(200, REPO_JSON.into())],
    );
    github.on("/repos/expressjs/express/commits/HEAD", [sha_reply()]);

    let asked = RepoName::parse("ExpressJS/Express").unwrap();
    let snapshot = github.client(None).resolve(&asked).await.unwrap();

    assert_eq!(snapshot.repo.to_string(), "expressjs/express");
    assert_eq!(snapshot.default_branch, "master");
    assert_eq!(snapshot.sha, SHA);
}

#[tokio::test]
async fn a_missing_repository_is_not_found() {
    let github = FakeGithub::start().await;
    let error = github.client(None).resolve(&repo()).await.unwrap_err();
    assert_eq!(error, GithubError::NotFound);
}

#[tokio::test]
async fn a_private_repository_is_not_found_either() {
    let github = FakeGithub::start().await;
    let private = REPO_JSON
        .replacen(r#""private": false"#, r#""private": true"#, 1)
        .replace("expressjs/express", "acme/harbor");
    assert_ne!(private, REPO_JSON);
    github.on("/repos/acme/harbor", [Reply::Json(200, private)]);
    github.on("/repos/acme/harbor/commits/HEAD", [sha_reply()]);

    let error = github.client(None).resolve(&repo()).await.unwrap_err();
    assert_eq!(error, GithubError::NotFound);
    assert!(
        github
            .requests("/repos/acme/harbor/commits/HEAD")
            .is_empty()
    );
}

#[tokio::test]
async fn a_repository_without_commits_is_empty() {
    let github = FakeGithub::start().await;
    github.on(
        "/repos/expressjs/express",
        [Reply::Json(200, REPO_JSON.into())],
    );
    let conflict = r#"{"message":"Git Repository is empty."}"#;
    github.on(
        "/repos/expressjs/express/commits/HEAD",
        [Reply::Json(409, conflict.into())],
    );

    let express = RepoName::parse("expressjs/express").unwrap();
    let error = github.client(None).resolve(&express).await.unwrap_err();
    assert_eq!(error, GithubError::Empty);
}

#[tokio::test]
async fn resolving_does_not_wait_out_a_rate_limit() {
    let github = FakeGithub::start().await;
    github.on(
        "/repos/acme/harbor",
        [Reply::Text {
            status: 403,
            content_type: "application/json",
            body: r#"{"message":"API rate limit exceeded"}"#.into(),
            headers: vec![("x-ratelimit-remaining", "0".into())],
        }],
    );

    let error = github.client(None).resolve(&repo()).await.unwrap_err();
    assert_eq!(error, GithubError::RateLimited);
    assert_eq!(github.requests("/repos/acme/harbor").len(), 1);
}

#[tokio::test]
async fn server_errors_are_retried_three_times() {
    let github = FakeGithub::start().await;
    github.on("/repos/acme/harbor", [Reply::text(502, "Bad Gateway")]);

    let error = github.client(None).resolve(&repo()).await.unwrap_err();
    assert_eq!(error, GithubError::Unavailable);
    assert_eq!(github.requests("/repos/acme/harbor").len(), 3);
}

#[tokio::test]
async fn a_server_error_then_an_answer_succeeds() {
    let github = FakeGithub::start().await;
    github.on(
        &tarball_path(),
        [
            Reply::text(503, "Unavailable"),
            Reply::Archive(tarball(&[])),
        ],
    );

    let response = github.client(None).tarball(&repo(), SHA, &no_wait).await;
    assert!(response.is_ok());
    assert_eq!(github.requests(&tarball_path()).len(), 2);
}

#[tokio::test]
async fn an_unreachable_github_is_unavailable() {
    let endpoints = Endpoints {
        api: "http://127.0.0.1:1".into(),
        codeload: "http://127.0.0.1:1".into(),
    };
    let client = GithubClient::with_endpoints(None, endpoints, fake_github::fast_retry()).unwrap();
    let error = client.resolve(&repo()).await.unwrap_err();
    assert_eq!(error, GithubError::Unavailable);
}

#[tokio::test]
async fn a_rate_limited_download_waits_then_resumes() {
    let github = FakeGithub::start().await;
    let limited = "429: This request was rate-limited due to too many requests from your network.";
    github.on(
        &tarball_path(),
        [Reply::text(429, limited), Reply::Archive(tarball(&[]))],
    );

    let waits = Mutex::new(Vec::new());
    let on_wait = |wait| waits.lock().unwrap().push(wait);
    let response = github.client(None).tarball(&repo(), SHA, &on_wait).await;

    assert!(response.is_ok());
    assert_eq!(*waits.lock().unwrap(), [Duration::from_millis(10)]);
}

#[tokio::test]
async fn a_rate_limit_announced_beyond_the_maximum_fails_at_once() {
    let github = FakeGithub::start().await;
    github.on(
        &tarball_path(),
        [Reply::Text {
            status: 429,
            content_type: "text/plain",
            body: "slow down".into(),
            headers: vec![("retry-after", "600".into())],
        }],
    );

    let waits = Mutex::new(Vec::new());
    let on_wait = |wait| waits.lock().unwrap().push(wait);
    let error = github
        .client(None)
        .tarball(&repo(), SHA, &on_wait)
        .await
        .unwrap_err();

    assert_eq!(error, GithubError::RateLimited);
    assert!(waits.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_download_that_never_answers_is_retried_then_unavailable() {
    let github = FakeGithub::start().await;
    github.on(&tarball_path(), [Reply::Stalled]);

    let error = github
        .client(None)
        .tarball(&repo(), SHA, &no_wait)
        .await
        .unwrap_err();
    assert_eq!(error, GithubError::Unavailable);
    assert_eq!(github.requests(&tarball_path()).len(), 3);
}

#[tokio::test]
async fn a_secondary_rate_limit_is_waited_out() {
    let github = FakeGithub::start().await;
    github.on(
        &tarball_path(),
        [
            Reply::Text {
                status: 403,
                content_type: "application/json",
                body: r#"{"message":"You have exceeded a secondary rate limit."}"#.into(),
                headers: vec![
                    ("retry-after", "0".into()),
                    ("x-ratelimit-remaining", "4999".into()),
                ],
            },
            Reply::Archive(tarball(&[])),
        ],
    );

    let waits = Mutex::new(Vec::new());
    let on_wait = |wait| waits.lock().unwrap().push(wait);
    let response = github.client(None).tarball(&repo(), SHA, &on_wait).await;

    assert!(response.is_ok());
    // An announced wait lasts 1 s at least
    assert_eq!(*waits.lock().unwrap(), [Duration::from_secs(1)]);
}

#[tokio::test]
async fn an_error_page_is_not_taken_for_an_archive() {
    let github = FakeGithub::start().await;
    github.on(
        &tarball_path(),
        [Reply::Text {
            status: 200,
            content_type: "text/html; charset=utf-8",
            body: "<html>Unicorn!</html>".into(),
            headers: Vec::new(),
        }],
    );

    let error = github
        .client(None)
        .tarball(&repo(), SHA, &no_wait)
        .await
        .unwrap_err();
    assert!(matches!(error, GithubError::Unexpected(_)));
}

#[tokio::test]
async fn the_token_goes_to_github_and_nowhere_else() {
    let github = FakeGithub::start().await;
    github.on("/repos/acme/harbor", [Reply::text(500, "boom")]);
    github.on(&tarball_path(), [Reply::Archive(tarball(&[]))]);
    let client = github.client(Some("ghp_secret_value"));

    let error = client.resolve(&repo()).await.unwrap_err();
    client.tarball(&repo(), SHA, &no_wait).await.unwrap();

    let bearer = Some("Bearer ghp_secret_value".to_owned());
    assert!(
        github
            .requests("/repos/acme/harbor")
            .iter()
            .all(|auth| *auth == bearer)
    );
    assert_eq!(github.requests(&tarball_path()), [bearer]);
    assert!(!format!("{client:?}").contains("ghp_secret_value"));
    assert!(!format!("{error:?} {error}").contains("ghp_secret_value"));
}

#[tokio::test]
async fn anonymous_requests_carry_no_authorization() {
    let github = FakeGithub::start().await;
    github.on(&tarball_path(), [Reply::Archive(tarball(&[]))]);
    github
        .client(None)
        .tarball(&repo(), SHA, &no_wait)
        .await
        .unwrap();
    assert_eq!(github.requests(&tarball_path()), [None]);
}
