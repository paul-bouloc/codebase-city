# Codebase City

Paste the URL of a public GitHub repository and explore it as a 3D city.

- **Districts** are directories.
- **Buildings** are files: height reflects complexity, footprint reflects size.
- **Light trails** are dependencies between files.
- **A guide** takes you on a tour of the architecture: entry points, core files, layers, cycles. Everything it shows is computed from the code itself.

> **Status:** early work in progress. Nothing runnable yet.

## How it works

1. A Rust service downloads the repository archive, skips generated, vendored and binary files, and parses the source with [tree-sitter](https://tree-sitter.github.io/).
2. Imports are resolved to files in the repository to build a dependency graph, along with per-file metrics.
3. Graph analysis finds entry points, central files, layers between directories and dependency cycles.
4. The browser lays out the city and renders it with [three.js](https://threejs.org/), using instancing and level of detail to stay smooth on large repositories.

The first supported languages are TypeScript/JavaScript, Python and Go.

## Development

Prerequisites:

- [Rust](https://rustup.rs/) through rustup (the toolchain is pinned in `rust-toolchain.toml`)
- [Node.js](https://nodejs.org/) 24 and [pnpm](https://pnpm.io/) (pinned in `web/package.json`)
- [just](https://github.com/casey/just), the command runner
- [Docker](https://www.docker.com/) with Docker Compose, for the local Postgres

```sh
cd web && pnpm install && cd ..
cp .env.example .env
just check    # format, lint, types, tests and build: what CI runs
just db-up    # start Postgres on localhost:55432
just dev      # start the server and the web dev server (http://localhost:5173)
```

The server reads its configuration from the environment (see `.env.example`) and refuses to start when a required variable is missing.

Run `just` to list every recipe.

## License

[MIT](LICENSE)
