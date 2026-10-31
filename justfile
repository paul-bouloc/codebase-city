# Run `just` to list the recipes.

set shell := ["bash", "-euo", "pipefail", "-c"]
set dotenv-load

# The local Postgres from docker-compose.yml, unless .env or the caller says otherwise
export DATABASE_URL := env("DATABASE_URL", "postgres://codebase_city:codebase_city@localhost:55432/codebase_city")

default:
    @just --list

# Everything CI runs: format, lint, types, tests and build, Rust and web
check: check-rust check-web

# Rust: format, lint and tests (starts the local Postgres for the integration tests)
check-rust: db-up
    cargo fmt --all --check
    cargo clippy --workspace --all-targets --locked -- -D warnings
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

# Run the tests, Rust and web
test: db-up
    cargo test --workspace --locked
    cd web && pnpm run test

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
