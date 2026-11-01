//! A local stand-in for api.github.com and codeload.github.com: each path
//! answers from a queue of canned replies, and every request is recorded.

// Each test file compiles this module on its own and uses only part of it.
#![allow(dead_code)]

use std::collections::{HashMap, VecDeque};
use std::io::Write;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use flate2::Compression;
use flate2::write::GzEncoder;
use server::github::{Endpoints, GithubClient, RepoName, RetryPolicy, Token};
use tokio::net::TcpListener;

pub const SHA: &str = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d";

#[derive(Clone)]
pub enum Reply {
    Json(u16, String),
    Text {
        status: u16,
        content_type: &'static str,
        body: String,
        headers: Vec<(&'static str, String)>,
    },
    Archive(Vec<u8>),
    /// The archive in small chunks, with a pause before each.
    SlowArchive(Vec<u8>, Duration),
    /// Accepts the request and sends nothing for an hour.
    Stalled,
}

impl Reply {
    pub fn text(status: u16, body: &str) -> Self {
        Self::Text {
            status,
            content_type: "text/plain",
            body: body.to_owned(),
            headers: Vec::new(),
        }
    }
}

#[derive(Default)]
struct Fake {
    replies: Mutex<HashMap<String, VecDeque<Reply>>>,
    /// Path and `Authorization` header of each request, in order.
    requests: Mutex<Vec<(String, Option<String>)>>,
}

pub struct FakeGithub {
    pub url: String,
    fake: Arc<Fake>,
}

impl FakeGithub {
    pub async fn start() -> Self {
        let fake = Arc::new(Fake::default());
        let app = Router::new().fallback(answer).with_state(Arc::clone(&fake));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Self { url, fake }
    }

    /// Queues replies for a path; the last one repeats. Unknown paths get a 404.
    pub fn on(&self, path: &str, replies: impl IntoIterator<Item = Reply>) {
        self.fake
            .replies
            .lock()
            .unwrap()
            .insert(path.to_owned(), replies.into_iter().collect());
    }

    /// The `Authorization` header of every request to `path`.
    pub fn requests(&self, path: &str) -> Vec<Option<String>> {
        let requests = self.fake.requests.lock().unwrap();
        requests
            .iter()
            .filter(|(requested, _)| requested == path)
            .map(|(_, authorization)| authorization.clone())
            .collect()
    }

    pub fn client(&self, token: Option<&str>) -> GithubClient {
        let endpoints = Endpoints {
            api: self.url.clone(),
            codeload: self.url.clone(),
        };
        GithubClient::with_endpoints(token.map(|t| Token::new(t.into())), endpoints, fast_retry())
            .unwrap()
    }
}

pub fn fast_retry() -> RetryPolicy {
    RetryPolicy {
        attempts: 3,
        backoff: Duration::from_millis(1),
        rate_limit_wait: Duration::from_millis(10),
        max_rate_limit_wait: Duration::from_secs(1),
        // Long enough for a loaded machine, short enough for the stalled test
        response_timeout: Duration::from_millis(500),
    }
}

pub fn repo() -> RepoName {
    RepoName::parse("acme/harbor").unwrap()
}

pub fn tarball_path() -> String {
    format!("/acme/harbor/tar.gz/{SHA}")
}

async fn answer(State(fake): State<Arc<Fake>>, request: Request) -> Response {
    let path = request.uri().path().to_owned();
    let authorization = request
        .headers()
        .get(header::AUTHORIZATION)
        .map(|value| value.to_str().unwrap().to_owned());
    fake.requests
        .lock()
        .unwrap()
        .push((path.clone(), authorization));

    let reply = {
        let mut replies = fake.replies.lock().unwrap();
        match replies.get_mut(&path) {
            Some(queue) if queue.len() > 1 => queue.pop_front(),
            Some(queue) => queue.front().cloned(),
            None => None,
        }
    };
    let status = |code| StatusCode::from_u16(code).unwrap();
    match reply {
        None => (StatusCode::NOT_FOUND, r#"{"message":"Not Found"}"#).into_response(),
        Some(Reply::Json(code, body)) => (
            status(code),
            [(header::CONTENT_TYPE, "application/json")],
            body,
        )
            .into_response(),
        Some(Reply::Text {
            status: code,
            content_type,
            body,
            headers,
        }) => {
            let mut response =
                (status(code), [(header::CONTENT_TYPE, content_type)], body).into_response();
            for (name, value) in headers {
                response.headers_mut().insert(name, value.parse().unwrap());
            }
            response
        }
        Some(Reply::Stalled) => {
            tokio::time::sleep(Duration::from_secs(3600)).await;
            StatusCode::GATEWAY_TIMEOUT.into_response()
        }
        Some(Reply::Archive(bytes)) => {
            ([(header::CONTENT_TYPE, "application/x-gzip")], bytes).into_response()
        }
        Some(Reply::SlowArchive(bytes, pause)) => {
            let chunks: Vec<Vec<u8>> = bytes.chunks(64).map(<[u8]>::to_vec).collect();
            let stream =
                futures_util::stream::unfold(chunks.into_iter(), move |mut chunks| async move {
                    let chunk = chunks.next()?;
                    tokio::time::sleep(pause).await;
                    Some((Ok::<_, std::io::Error>(chunk), chunks))
                });
            (
                [(header::CONTENT_TYPE, "application/x-gzip")],
                Body::from_stream(stream),
            )
                .into_response()
        }
    }
}

/// A gzipped tarball laid out like GitHub's: a global pax header with the
/// commit, then every file under an `owner-repo-sha/` folder.
pub fn tarball(files: &[(&str, &[u8])]) -> Vec<u8> {
    let root = format!("acme-harbor-{}", &SHA[..7]);
    let mut builder = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::default()));

    let comment = format!("52 comment={SHA}\n");
    let mut header = tar::Header::new_ustar();
    header.set_entry_type(tar::EntryType::XGlobalHeader);
    header.set_size(comment.len() as u64);
    builder
        .append_data(&mut header, "pax_global_header", comment.as_bytes())
        .unwrap();

    let mut header = tar::Header::new_ustar();
    header.set_entry_type(tar::EntryType::Directory);
    header.set_mode(0o755);
    header.set_size(0);
    builder
        .append_data(&mut header, format!("{root}/"), std::io::empty())
        .unwrap();

    for (path, content) in files {
        let mut header = tar::Header::new_ustar();
        header.set_mode(0o644);
        header.set_size(content.len() as u64);
        builder
            .append_data(&mut header, format!("{root}/{path}"), *content)
            .unwrap();
    }
    let mut gzip = builder.into_inner().unwrap();
    gzip.flush().unwrap();
    gzip.finish().unwrap()
}
