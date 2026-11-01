//! GitHub client: finds the commit to analyze and opens its source archive.
//!
//! Every answer is checked before use: a rate-limited download comes back as
//! a short text page, which would otherwise surface as a corrupt archive.

use std::fmt;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::header::{self, HeaderMap, HeaderValue};
use reqwest::{RequestBuilder, Response, StatusCode};
use serde::Deserialize;

const API_URL: &str = "https://api.github.com";
const CODELOAD_URL: &str = "https://codeload.github.com";
const USER_AGENT: &str = concat!("codebase-city/", env!("CARGO_PKG_VERSION"));
const API_TIMEOUT: Duration = Duration::from_secs(15);

/// A repository name, checked against GitHub's own rules so it is safe to
/// put in a URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoName {
    owner: String,
    name: String,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
#[error("not a GitHub repository name: expected owner/repo")]
pub struct InvalidRepoName;

impl RepoName {
    /// Parses `owner/repo`.
    pub fn parse(full_name: &str) -> Result<Self, InvalidRepoName> {
        let (owner, name) = full_name.split_once('/').ok_or(InvalidRepoName)?;
        let owner_ok = (1..=39).contains(&owner.len())
            && owner
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-');
        let name_ok = (1..=100).contains(&name.len())
            && name != "."
            && name != ".."
            && name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'));
        if owner_ok && name_ok {
            Ok(Self {
                owner: owner.to_owned(),
                name: name.to_owned(),
            })
        } else {
            Err(InvalidRepoName)
        }
    }

    pub fn owner(&self) -> &str {
        &self.owner
    }

    pub fn name(&self) -> &str {
        &self.name
    }
}

impl fmt::Display for RepoName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}/{}", self.owner, self.name)
    }
}

/// The server's GitHub token. Its value never appears in `Debug` output.
#[derive(Clone)]
pub struct Token(String);

impl Token {
    pub fn new(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Debug for Token {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Token(..)")
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum GithubError {
    /// Missing and private repositories get the same answer, so the
    /// existence of a private repository never leaks.
    #[error("no public repository with this name")]
    NotFound,
    #[error("the repository has no commit yet")]
    Empty,
    /// GitHub kept limiting our requests for longer than we wait.
    #[error("GitHub's rate limit lasted too long")]
    RateLimited,
    /// Network errors or server errors on every attempt.
    #[error("GitHub did not answer")]
    Unavailable,
    #[error("unexpected answer from GitHub: {0}")]
    Unexpected(String),
}

/// The commit an analysis is about.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Snapshot {
    /// The name as GitHub spells it, which may differ in case or after a
    /// rename from the one asked for.
    pub repo: RepoName,
    pub default_branch: String,
    /// Full SHA of the last commit of the default branch.
    pub sha: String,
}

/// How long to insist when GitHub fails or limits us.
#[derive(Debug, Clone)]
pub struct RetryPolicy {
    /// Tries per request when GitHub fails (server error or network).
    pub attempts: u32,
    /// Delay before the second try, doubled before each following one.
    pub backoff: Duration,
    /// Wait after a rate limit that announces no reset time.
    pub rate_limit_wait: Duration,
    /// Total wait for rate limits, beyond which the request fails.
    pub max_rate_limit_wait: Duration,
    /// Wait for the status and headers of a response, beyond which the try
    /// counts as a network failure. The body has its own limits.
    pub response_timeout: Duration,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            attempts: 3,
            backoff: Duration::from_secs(1),
            rate_limit_wait: Duration::from_secs(60),
            max_rate_limit_wait: Duration::from_secs(5 * 60),
            response_timeout: Duration::from_secs(30),
        }
    }
}

/// Where GitHub lives; tests point this at a local fake.
#[derive(Debug, Clone)]
pub struct Endpoints {
    pub api: String,
    pub codeload: String,
}

impl Default for Endpoints {
    fn default() -> Self {
        Self {
            api: API_URL.to_owned(),
            codeload: CODELOAD_URL.to_owned(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct GithubClient {
    http: reqwest::Client,
    endpoints: Endpoints,
    retry: RetryPolicy,
}

#[derive(Deserialize)]
struct RepoResponse {
    full_name: String,
    private: bool,
    default_branch: String,
}

impl GithubClient {
    /// A client for github.com, anonymous without a token.
    pub fn new(token: Option<Token>) -> Result<Self, GithubError> {
        Self::with_endpoints(token, Endpoints::default(), RetryPolicy::default())
    }

    pub fn with_endpoints(
        token: Option<Token>,
        endpoints: Endpoints,
        retry: RetryPolicy,
    ) -> Result<Self, GithubError> {
        // rustls needs a process-wide crypto provider; an error only means one
        // is installed already.
        let _ = rustls::crypto::ring::default_provider().install_default();

        let mut headers = HeaderMap::new();
        if let Some(Token(token)) = token {
            let mut value = HeaderValue::try_from(format!("Bearer {token}"))
                .map_err(|_| GithubError::Unexpected("the token is not a valid header".into()))?;
            value.set_sensitive(true);
            headers.insert(header::AUTHORIZATION, value);
        }
        let http = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .default_headers(headers)
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|error| GithubError::Unexpected(error.to_string()))?;
        Ok(Self {
            http,
            endpoints,
            retry,
        })
    }

    /// Finds the last commit of the repository's default branch. Does not
    /// wait out a rate limit: the user is waiting for the answer.
    pub async fn resolve(&self, repo: &RepoName) -> Result<Snapshot, GithubError> {
        let url = format!("{}/repos/{repo}", self.endpoints.api);
        let response = self
            .send(|| self.api_get(&url, "application/vnd.github+json"), None)
            .await?;
        let body = match response.status() {
            StatusCode::OK => response
                .bytes()
                .await
                .map_err(|_| GithubError::Unavailable)?,
            StatusCode::NOT_FOUND => return Err(GithubError::NotFound),
            status => return Err(unexpected(status)),
        };
        let found: RepoResponse = serde_json::from_slice(&body)
            .map_err(|_| GithubError::Unexpected("unreadable repository details".into()))?;
        if found.private {
            return Err(GithubError::NotFound);
        }
        let canonical = RepoName::parse(&found.full_name)
            .map_err(|_| GithubError::Unexpected("unreadable repository name".into()))?;

        let url = format!("{}/repos/{canonical}/commits/HEAD", self.endpoints.api);
        let response = self
            .send(|| self.api_get(&url, "application/vnd.github.sha"), None)
            .await?;
        let sha = match response.status() {
            StatusCode::OK => response
                .text()
                .await
                .map_err(|_| GithubError::Unavailable)?,
            // GitHub answers 409 Conflict for a repository without commits.
            StatusCode::CONFLICT => return Err(GithubError::Empty),
            StatusCode::NOT_FOUND => return Err(GithubError::NotFound),
            status => return Err(unexpected(status)),
        };
        let sha = sha.trim();
        if !is_sha(sha) {
            return Err(GithubError::Unexpected("unreadable commit SHA".into()));
        }
        Ok(Snapshot {
            repo: canonical,
            default_branch: found.default_branch,
            sha: sha.to_owned(),
        })
    }

    /// Opens the gzipped tarball of a commit, checked to be one. Rate limits
    /// are waited out, and every wait is reported to `on_wait` first.
    pub async fn tarball(
        &self,
        repo: &RepoName,
        sha: &str,
        on_wait: &(dyn Fn(Duration) + Sync),
    ) -> Result<Response, GithubError> {
        if !is_sha(sha) {
            return Err(GithubError::Unexpected("not a commit SHA".into()));
        }
        let url = format!("{}/{repo}/tar.gz/{sha}", self.endpoints.codeload);
        let response = self.send(|| self.http.get(&url), Some(on_wait)).await?;
        match response.status() {
            StatusCode::OK if is_archive(response.headers()) => Ok(response),
            StatusCode::OK => Err(GithubError::Unexpected(
                "the archive is not a gzip file".into(),
            )),
            StatusCode::NOT_FOUND => Err(GithubError::NotFound),
            status => Err(unexpected(status)),
        }
    }

    fn api_get(&self, url: &str, accept: &'static str) -> RequestBuilder {
        self.http
            .get(url)
            .header(header::ACCEPT, accept)
            .header("X-GitHub-Api-Version", "2022-11-28")
            .timeout(API_TIMEOUT)
    }

    /// Sends a request, retrying server and network errors with a growing
    /// delay. Rate limits are waited out when `on_wait` is given, and fail
    /// the request otherwise.
    async fn send(
        &self,
        request: impl Fn() -> RequestBuilder,
        on_wait: Option<&(dyn Fn(Duration) + Sync)>,
    ) -> Result<Response, GithubError> {
        let mut failures = 0;
        let mut waited = Duration::ZERO;
        loop {
            let sent = tokio::time::timeout(self.retry.response_timeout, request().send()).await;
            match sent {
                Ok(Ok(response)) if is_rate_limited(&response) => {
                    let Some(on_wait) = on_wait else {
                        return Err(GithubError::RateLimited);
                    };
                    let wait =
                        announced_wait(response.headers()).unwrap_or(self.retry.rate_limit_wait);
                    waited += wait;
                    if waited > self.retry.max_rate_limit_wait {
                        return Err(GithubError::RateLimited);
                    }
                    on_wait(wait);
                    tokio::time::sleep(wait).await;
                    continue;
                }
                Ok(Ok(response)) if !response.status().is_server_error() => return Ok(response),
                Ok(Err(error)) if error.is_builder() => {
                    return Err(GithubError::Unexpected(error.to_string()));
                }
                // A server error, a network error, or no response in time
                _ => {}
            }
            failures += 1;
            if failures >= self.retry.attempts {
                return Err(GithubError::Unavailable);
            }
            tokio::time::sleep(self.retry.backoff * 2u32.saturating_pow(failures - 1)).await;
        }
    }
}

fn unexpected(status: StatusCode) -> GithubError {
    GithubError::Unexpected(format!("status {status}"))
}

fn is_sha(value: &str) -> bool {
    value.len() == 40 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// 429 everywhere, or a 403 once the hourly budget is spent or with a
/// `Retry-After`, as GitHub's secondary limits answer.
fn is_rate_limited(response: &Response) -> bool {
    let headers = response.headers();
    match response.status() {
        StatusCode::TOO_MANY_REQUESTS => true,
        StatusCode::FORBIDDEN => {
            headers.contains_key(header::RETRY_AFTER)
                || headers
                    .get("x-ratelimit-remaining")
                    .and_then(|value| value.to_str().ok())
                    == Some("0")
        }
        _ => false,
    }
}

/// The wait GitHub asks for, from `Retry-After` or the reset time of the
/// rate limit. Codeload announces neither.
fn announced_wait(headers: &HeaderMap) -> Option<Duration> {
    let number = |name: &str| headers.get(name)?.to_str().ok()?.trim().parse::<u64>().ok();
    if let Some(seconds) = number(header::RETRY_AFTER.as_str()) {
        return Some(Duration::from_secs(seconds.max(1)));
    }
    let reset = number("x-ratelimit-reset")?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs();
    Some(Duration::from_secs(reset.saturating_sub(now).max(1)))
}

/// Codeload sends `application/x-gzip`. Error pages come as text or JSON.
fn is_archive(headers: &HeaderMap) -> bool {
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    !(content_type.starts_with("text/") || content_type.contains("json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repository_names_follow_github_rules() {
        let repo = RepoName::parse("expressjs/express").unwrap();
        assert_eq!(repo.owner(), "expressjs");
        assert_eq!(repo.name(), "express");
        assert_eq!(repo.to_string(), "expressjs/express");
        assert!(RepoName::parse("my-org/my_repo.js").is_ok());

        for invalid in [
            "express",
            "/express",
            "expressjs/",
            "a/b/c",
            "owner/..",
            "own_er/repo",
            "owner/re po",
            "owner/repo?x=1",
            "owner/répo",
        ] {
            assert_eq!(RepoName::parse(invalid), Err(InvalidRepoName), "{invalid}");
        }
    }

    #[test]
    fn the_token_never_shows_in_debug_output() {
        let token = Token::new("ghp_secret".into());
        assert_eq!(format!("{token:?}"), "Token(..)");
    }

    #[test]
    fn the_announced_wait_comes_from_retry_after_or_the_reset_time() {
        let mut headers = HeaderMap::new();
        assert_eq!(announced_wait(&headers), None);

        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
        let reset = (now.as_secs() + 120).to_string();
        headers.insert("x-ratelimit-reset", reset.parse().unwrap());
        let wait = announced_wait(&headers).unwrap();
        assert!((Duration::from_secs(119)..=Duration::from_secs(120)).contains(&wait));

        headers.insert(header::RETRY_AFTER, "30".parse().unwrap());
        assert_eq!(announced_wait(&headers), Some(Duration::from_secs(30)));
    }
}
