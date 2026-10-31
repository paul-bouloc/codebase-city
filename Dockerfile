# Production image: the server binary and the built web app, nothing else.
# Base images are pinned by digest so a rebuild gives the same result.

# --- Rust -------------------------------------------------------------------

FROM rust:1.99.1-slim-trixie@sha256:b8e062b1c3a80183df83d9ba187cadd2b5ab84bc78d453dbfeb2fccd5f982247 AS chef
WORKDIR /build
COPY rust-toolchain.toml ./
# Installs the toolchain pinned in rust-toolchain.toml, whatever the base image ships
RUN rustup toolchain install
RUN cargo install --locked cargo-chef@0.1.78

# Lists the dependencies, so the next stage can build them in a cached layer
FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY crates crates
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS server
COPY --from=planner /build/recipe.json recipe.json
RUN cargo chef cook --release --locked --package server --recipe-path recipe.json
COPY Cargo.toml Cargo.lock ./
COPY crates crates
RUN cargo build --release --locked --package server --bin server

# --- Web --------------------------------------------------------------------

FROM node:24.21.0-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66 AS web
WORKDIR /build/web
# Uses the pnpm version from packageManager in package.json
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web ./
RUN pnpm run build

# --- Runtime ----------------------------------------------------------------

# glibc and libgcc for the binary, no shell, non-root user (65532)
FROM gcr.io/distroless/cc-debian13:nonroot@sha256:3ee00291cf386ec52a552e6a858d555debd74776eb4bfa53fa3df2cd6677515e
WORKDIR /app
COPY --from=server /build/target/release/server ./server
COPY --from=web /build/web/dist ./web
ENV HOST=0.0.0.0 \
    PORT=8080 \
    WEB_DIR=/app/web \
    LOG_FORMAT=json
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/app/server"]
