//! Integration tests against a real Postgres (`just db-up`). Each test gets
//! a fresh database with the migrations applied, created by `sqlx::test`
//! from `DATABASE_URL`.

// Test helpers are not `#[test]` functions, so clippy.toml does not cover them.
#![allow(clippy::unwrap_used)]

use std::path::Path;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use http_body_util::BodyExt;
use server::http::{AppState, router};
use sqlx::PgPool;
use tower::ServiceExt;

fn app(pool: PgPool) -> Router {
    let web_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/web");
    router(AppState { pool }, &web_dir)
}

async fn get(app: Router, uri: &str) -> (StatusCode, String, String) {
    let request = Request::get(uri).body(Body::empty()).unwrap();
    let response = app.oneshot(request).await.unwrap();
    let status = response.status();
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        content_type,
        String::from_utf8(body.to_vec()).unwrap(),
    )
}

#[sqlx::test(migrator = "server::store::MIGRATOR")]
async fn health_reports_the_version_and_the_database(pool: PgPool) {
    let (status, content_type, body) = get(app(pool), "/api/health").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(content_type, "application/json");
    let json: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(json["status"], "ok");
    assert_eq!(json["database"], "ok");
    assert_eq!(json["version"], env!("CARGO_PKG_VERSION"));
}

#[sqlx::test(migrator = "server::store::MIGRATOR")]
async fn health_is_unavailable_when_the_database_is_down(pool: PgPool) {
    let app = app(pool.clone());
    pool.close().await;
    let (status, _, body) = get(app, "/api/health").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    let json: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(json["status"], "unavailable");
}

#[sqlx::test(migrator = "server::store::MIGRATOR")]
async fn migrations_create_the_settings_table(pool: PgPool) {
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM settings")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[sqlx::test(migrator = "server::store::MIGRATOR")]
async fn an_unknown_api_route_is_a_json_404(pool: PgPool) {
    let (status, content_type, body) = get(app(pool), "/api/nope").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(content_type, "application/json");
    let json: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(json["code"], "not_found");
}

#[sqlx::test(migrator = "server::store::MIGRATOR")]
async fn static_files_are_served(pool: PgPool) {
    let (status, content_type, body) = get(app(pool), "/assets/app.js").await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        content_type.starts_with("text/javascript"),
        "{content_type}"
    );
    assert!(body.contains("fixture"));
}

#[sqlx::test(migrator = "server::store::MIGRATOR")]
async fn front_end_routes_fall_back_to_the_index(pool: PgPool) {
    let (status, content_type, body) = get(app(pool), "/r/owner/repo").await;
    assert_eq!(status, StatusCode::OK);
    assert!(content_type.starts_with("text/html"), "{content_type}");
    assert!(body.contains("<title>fixture</title>"));
}
