# Run `just` to list the recipes.

set shell := ["bash", "-euo", "pipefail", "-c"]
set dotenv-load

# The local Postgres from docker-compose.yml, unless .env or the caller says otherwise
export DATABASE_URL := env("DATABASE_URL", "postgres://codebase_city:codebase_city@localhost:55432/codebase_city")
# SQL queries are checked against crates/server/.sqlx, not the live database, so the build never depends on its state
export SQLX_OFFLINE := env("SQLX_OFFLINE", "true")

default:
    @just --list

# Everything CI runs: format, lint, types, tests and build, Rust and web
check: check-rust check-web

# Rust: format, lint, doc links and tests (starts the local Postgres for the integration tests)
check-rust: db-up
    cargo fmt --all --check
    cargo clippy --workspace --all-targets --locked -- -D warnings
    RUSTDOCFLAGS="-D warnings" cargo doc --workspace --no-deps --document-private-items --locked
    cargo test --workspace --locked

# Web: format and lint, types, tests and build
check-web:
    cd web && pnpm exec biome ci .
    cd web && pnpm run typecheck
    cd web && pnpm run test
    cd web && pnpm run build

# Format and apply safe lint fixes, Rust and web
fmt:
    cargo fmt --all
    cd web && pnpm run format

# Regenerate the TypeScript types and the sample result from crates/model
gen-types:
    rm -rf web/src/data/generated
    cargo test -p model --locked

# Fail when the generated files differ from what is committed (run by CI)
check-generated: gen-types
    #!/usr/bin/env bash
    set -euo pipefail
    changes=$(git status --porcelain -- web/src/data/generated)
    if [ -n "$changes" ]; then
        echo "$changes"
        echo "web/src/data/generated is out of date: run 'just gen-types' and commit the result." >&2
        exit 1
    fi

# Run the tests, Rust and web
test: db-up
    cargo test --workspace --locked
    cd web && pnpm run test

# Ingest and analyze a real GitHub repository and print what came out (GITHUB_TOKEN if set); `--out file.json` writes the result, `--store` saves it in the database
ingest repo *args:
    cargo run --release --locked -p server --example ingest -- {{repo}} {{args}}

# Refresh the query cache in crates/server/.sqlx after changing a query or a migration (needs sqlx-cli)
sqlx-prepare: db-up
    sqlx migrate run --source crates/server/migrations
    cd crates/server && cargo sqlx prepare -- --all-targets --locked

# Start the local Postgres and wait until it is healthy
db-up:
    docker compose up -d --wait postgres

# Stop the local Postgres (data is kept in a named volume)
db-down:
    docker compose down

# Start the server and the web dev server (Vite proxies /api to the server)
dev: db-up
    #!/usr/bin/env bash
    set -euo pipefail
    cargo run -p server &
    server=$!
    trap 'kill $server 2>/dev/null || true' EXIT
    cd web && pnpm run dev

# Start the server alone, serving the built web app from web/dist
serve: db-up
    cargo run -p server
