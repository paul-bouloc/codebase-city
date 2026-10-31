use std::process::ExitCode;

use anyhow::Context;
use server::config::Config;
use server::http::{self, AppState};
use server::{store, telemetry};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> ExitCode {
    let config = match Config::from_env() {
        Ok(config) => config,
        Err(error) => {
            // Logging is not set up yet: its format is part of the config.
            eprintln!("configuration error: {error}");
            return ExitCode::FAILURE;
        }
    };
    telemetry::init(config.log_format);

    match run(config).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!("{error:#}");
            ExitCode::FAILURE
        }
    }
}

async fn run(config: Config) -> anyhow::Result<()> {
    let pool = store::connect(&config.database_url)
        .await
        .context("could not connect to the database or apply migrations")?;

    if !config.web_dir.join("index.html").is_file() {
        tracing::warn!(
            web_dir = %config.web_dir.display(),
            "web app not found: build it with `pnpm run build` in web/"
        );
    }

    let app = http::router(AppState { pool: pool.clone() }, &config.web_dir);
    let listener = TcpListener::bind(config.addr)
        .await
        .with_context(|| format!("could not listen on {}", config.addr))?;
    tracing::info!(addr = %config.addr, version = env!("CARGO_PKG_VERSION"), "server started");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("server error")?;

    pool.close().await;
    tracing::info!("server stopped");
    Ok(())
}

/// Resolves on Ctrl+C or SIGTERM (what Docker and Railway send on stop).
async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::error!(%error, "could not listen for Ctrl+C");
            std::future::pending::<()>().await;
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => {
                tracing::error!(%error, "could not listen for SIGTERM");
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {}
        () = terminate => {}
    }
    tracing::info!("shutdown signal received, draining connections");
}
