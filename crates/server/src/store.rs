//! Database access.

use std::time::Duration;

use sqlx::PgPool;
use sqlx::migrate::Migrator;
use sqlx::postgres::PgPoolOptions;

pub static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

/// Connects to Postgres and applies pending migrations.
pub async fn connect(database_url: &str) -> anyhow::Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(5))
        .connect(database_url)
        .await?;
    MIGRATOR.run(&pool).await?;
    Ok(pool)
}

/// Checks that the database answers a trivial query.
pub async fn ping(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT 1").execute(pool).await.map(|_| ())
}
