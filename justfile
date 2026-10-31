# Run `just` to list the recipes.

set shell := ["bash", "-euo", "pipefail", "-c"]

default:
    @just --list

# Everything CI runs: format, lint, types, tests and build, Rust and web
check: check-rust check-web

# Rust: format, lint and tests
check-rust:
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
test:
    cargo test --workspace --locked
    cd web && pnpm run test

# Start the local Postgres and wait until it is healthy
db-up:
    docker compose up -d --wait postgres

# Stop the local Postgres (data is kept in a named volume)
db-down:
    docker compose down

# Start the web dev server
dev:
    cd web && pnpm run dev
