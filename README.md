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

## License

[MIT](LICENSE)
