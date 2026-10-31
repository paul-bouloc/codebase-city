//! HTTP routes: the API under `/api`, and the web app for everything else.

use std::path::Path;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use sqlx::PgPool;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use crate::store;

const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
}

/// Builds the whole application. Unknown paths outside `/api` get
/// `index.html`, so the front-end router can handle them.
pub fn router(state: AppState, web_dir: &Path) -> Router {
    let api = Router::new()
        .route("/health", get(health))
        .fallback(api_not_found)
        .with_state(state);

    let web = ServeDir::new(web_dir).fallback(ServeFile::new(web_dir.join("index.html")));

    Router::new()
        .nest("/api", api)
        .fallback_service(web)
        .layer(TraceLayer::new_for_http())
}

#[derive(Debug, Serialize)]
pub struct Health {
    pub status: &'static str,
    pub version: &'static str,
    pub database: &'static str,
}

async fn health(State(state): State<AppState>) -> (StatusCode, Json<Health>) {
    match store::ping(&state.pool).await {
        Ok(()) => (
            StatusCode::OK,
            Json(Health {
                status: "ok",
                version: VERSION,
                database: "ok",
            }),
        ),
        Err(error) => {
            tracing::warn!(%error, "health check: database unavailable");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(Health {
                    status: "unavailable",
                    version: VERSION,
                    database: "unavailable",
                }),
            )
        }
    }
}

/// An API error, in the shape the front end expects. The `code` is stable;
/// the front end picks the message it shows.
#[derive(Debug, Serialize)]
pub struct ApiError {
    pub code: &'static str,
    pub message: &'static str,
    #[serde(skip)]
    pub status: StatusCode,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(self)).into_response()
    }
}

async fn api_not_found() -> ApiError {
    ApiError {
        code: "not_found",
        message: "No such API route.",
        status: StatusCode::NOT_FOUND,
    }
}
