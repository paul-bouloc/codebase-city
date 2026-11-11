//! The analysis result: what the analyzer produces and the web app renders.
//!
//! Tables are stored by column: each property is an array, and row `i` of a
//! table is the `i`-th element of every column. Rows refer to each other by
//! index, never by path, which keeps the JSON small and lets the browser load
//! columns straight into typed arrays.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Version of the shape of the data. Bumped on any change the web app has to
/// know about; a result with another version is rejected, not guessed at.
pub const FORMAT_VERSION: u32 = 11;

/// One analysis of one repository at one commit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AnalysisResult {
    /// Always [`FORMAT_VERSION`] for a result built by this code.
    pub format_version: u32,
    /// Version of the algorithms that produced the result. Results from
    /// another version are recomputed, not reused.
    pub analyzer_version: String,
    pub repo: Repo,
    /// Full SHA of the analyzed commit.
    pub sha: String,
    pub dirs: Dirs,
    /// Language names, referred to by [`Files::language`].
    pub languages: Vec<String>,
    pub files: Files,
    pub symbols: Symbols,
    pub edges: Edges,
    pub roles: Roles,
    pub islands: Islands,
    pub links: Links,
    pub cycles: Cycles,
    /// How the repository declares its packages, one row per declaration:
    /// a repository can declare JavaScript, Go and Python packages side by
    /// side. Empty when it declares none.
    pub workspaces: Vec<Workspace>,
    pub packages: Packages,
    pub package_groups: PackageGroups,
    pub externals: Externals,
    pub layout: Layout,
    pub tour: Tour,
    pub stats: Stats,
}

/// A GitHub repository, `owner/name`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Repo {
    pub owner: String,
    pub name: String,
}

/// The folder tree, one row per folder.
///
/// Row 0 is the repository root, and every folder comes after its parent, so
/// paths can be built in a single pass.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Dirs {
    /// Index of the parent folder; `null` for the root only.
    pub parent: Vec<Option<u32>>,
    /// Folder name, without slashes; empty for the root only.
    pub name: Vec<String>,
    /// The island the folder's own files belong to; `null` for a folder
    /// split into islands that holds no file of its own.
    pub island: Vec<Option<u32>>,
}

/// The files kept after ingestion, one row per file.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Files {
    /// Index of the folder holding the file.
    pub dir: Vec<u32>,
    /// File name, without slashes.
    pub name: Vec<String>,
    /// Index into [`AnalysisResult::languages`].
    pub language: Vec<u32>,
    /// Lines, blank and comment lines included, as GitHub counts them.
    pub lines: Vec<u32>,
    /// Cyclomatic complexity; `null` when the language is not analyzed or
    /// the file is too large to be read.
    pub complexity: Vec<Option<u32>>,
    /// Generated code: shown in the city, left out of every ranking.
    pub generated: Vec<bool>,
    /// What part of the repository the file belongs to, from its path.
    pub scope: Vec<Scope>,
    /// The file's leading comment or docstring, verbatim, a license block
    /// skipped; `null` when there is none or the language is not analyzed.
    pub header: Vec<Option<String>>,
    /// A facade: a file made of re-exports, such as an `index.ts` that
    /// gathers its package. Left out of the rankings.
    pub barrel: Vec<bool>,
    /// Production files that depend on this one, directly or not; `null`
    /// outside production, or when the repository was too large to count.
    /// The files of a Go package share the package's count.
    pub dependents: Vec<Option<u32>>,
    /// Production files this one depends on, directly or not; `null` as for
    /// [`Files::dependents`].
    pub dependencies: Vec<Option<u32>>,
}

/// What part of the repository a file belongs to. Rankings only look at
/// [`Scope::Source`], the code the project ships.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Scope {
    Source,
    Test,
    /// Data and mocks for the tests.
    Fixture,
    /// Examples, demos and samples.
    Example,
    Docs,
    Bench,
    /// Build output and build tooling.
    Build,
    /// Configuration of tools: manifests, dotfiles, `*.config.*`.
    Config,
}

/// Symbols exported by the analyzed files, one row per symbol, sorted by
/// file, then by line.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Symbols {
    /// Index of the file that exports the symbol.
    pub file: Vec<u32>,
    pub name: Vec<String>,
    pub kind: Vec<SymbolKind>,
    /// Line of the declaration, from 1.
    pub line: Vec<u32>,
}

/// What an exported symbol is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SymbolKind {
    /// A class, or a Go struct.
    Class,
    Function,
    Interface,
    /// A type alias, or a Go type that is neither a struct nor an interface.
    Type,
    Enum,
    /// An exported value that is not a function.
    Constant,
}

/// Resolved imports, one row per importing file and target, sorted by
/// importing file, then file targets by index, then folder targets by index.
///
/// Several imports of the same target make one edge, with the strongest
/// kind and the best confidence.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Edges {
    /// Index of the importing file.
    pub from: Vec<u32>,
    /// Index of the imported file; `null` when the import targets a folder.
    /// Never the importing file itself.
    pub to: Vec<Option<u32>>,
    /// Index of the imported folder, for languages whose imports name a
    /// package rather than a file (Go); `null` when the target is a file.
    pub to_dir: Vec<Option<u32>>,
    pub kind: Vec<EdgeKind>,
    pub confidence: Vec<Confidence>,
}

/// How a file imports another.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum EdgeKind {
    /// A plain import, evaluated when the importing file loads.
    Import,
    /// Types only, erased at runtime.
    Type,
    /// Inside a function, evaluated on first call.
    Lazy,
    /// A dynamic `import()` or equivalent.
    Dynamic,
    /// Re-exported to the importing file's own importers.
    Reexport,
}

/// How sure the analyzer is that an import points to this file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Confidence {
    /// Resolved by the language's own rules.
    Exact,
    /// Matched by a heuristic, shown as "likely".
    Likely,
}

/// What the import graph says about the production code: where it
/// starts, what everything rests on, and what pulls it together.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Roles {
    pub entries: Entries,
    /// The most depended on, by [`Files::dependents`]: the counts are
    /// dependents.
    pub foundations: Ranked,
    /// The files that pull the most code together without being much
    /// depended on, by [`Files::dependencies`]: the counts are dependencies.
    pub conductors: Ranked,
}

/// Entry points, one row each, the most likely first.
///
/// A row targets a file, or for Go a package folder found by the graph
/// alone, as [`Edges::to`] and [`Edges::to_dir`] do.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Entries {
    pub file: Vec<Option<u32>>,
    pub dir: Vec<Option<u32>>,
    /// Why it is an entry point, the strongest reason first; never empty.
    pub reasons: Vec<Vec<EntryReason>>,
    /// The name of the command it starts, when a manifest or a `cmd/`
    /// folder gives one.
    pub command: Vec<Option<String>>,
}

/// Why a file is taken for an entry point.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum EntryReason {
    /// Listed in `bin` of a `package.json`.
    PackageBin,
    /// Listed as `main`, `module` or `exports["."]` of a `package.json`.
    PackageMain,
    /// Run by the `start`, `dev` or `serve` script of a `package.json`.
    PackageScript,
    /// A script of `pyproject.toml` (`[project.scripts]`).
    PyprojectScript,
    /// A `console_scripts` entry point of `setup.cfg`.
    SetupCfgScript,
    /// A Go `func main` in `package main`.
    GoMain,
    /// A Python package's `__main__.py`.
    MainModule,
    /// A Python `if __name__ == "__main__":`.
    MainBlock,
    /// `manage.py`, `wsgi.py` or `asgi.py`.
    Framework,
    /// A name entry points usually have (`main`, `index`, `server`, `app`,
    /// `cli`), at the root of a package.
    ConventionalName,
    /// Imported by no production file, while depending on many: a guess
    /// from the graph alone.
    NoImporter,
}

/// A ranking, one row per place, the first first. A row targets a file,
/// or for Go a package folder.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Ranked {
    pub file: Vec<Option<u32>>,
    pub dir: Vec<Option<u32>>,
    /// The measure it is ranked by, in production files.
    pub count: Vec<u32>,
}

/// The islands of the city, one row per island, sorted by folder.
///
/// An island is a top-level folder. A folder holding more than half of the
/// production code is split instead: its subfolders become islands, and the
/// files directly in it make an island of their own, under its name. Files
/// at the root make the root island.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Islands {
    /// The folder the island is named after.
    pub dir: Vec<u32>,
    /// Layer of the island's production code, from 1 at the bottom: an
    /// island mostly imports islands of lower layers. In a monorepo, only
    /// the islands of its packages have layers. `null` for an island
    /// without production code, or outside a monorepo's packages.
    pub layer: Vec<Option<u32>>,
}

/// Imports between islands, one row per importing island and imported
/// island, sorted by both.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Links {
    pub from: Vec<u32>,
    pub to: Vec<u32>,
    /// Edges of [`Edges`] from a file of `from` to a file or package of
    /// `to`.
    pub imports: Vec<u32>,
    /// How many of them go up the layers, `to` being in a higher layer
    /// than `from`. A barrel's re-exports do not count: it offers what it
    /// re-exports, it does not depend on it.
    pub upward: Vec<u32>,
    /// Of [`Links::imports`], the plain imports and re-exports from a
    /// production file that is not a barrel to production code: the
    /// imports [`Islands::layer`] is read from. Tests and type imports are
    /// left out.
    pub production: Vec<u32>,
    /// How many of them go up the layers.
    pub production_upward: Vec<u32>,
}

/// Production files that import each other in a loop, one row per loop,
/// the largest first: every file of a loop reaches every other one through
/// plain imports and re-exports.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Cycles {
    /// The files of the loop, sorted; two or more.
    pub members: Vec<Vec<u32>>,
    /// One of the shortest loops through them, in import order: each file
    /// imports the next, and the last one the first.
    pub shortest: Vec<Vec<u32>>,
}

/// The manifest that declares the packages of a monorepo.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Workspace {
    pub kind: WorkspaceKind,
    /// The file that declares the packages.
    pub manifest: u32,
}

/// Which tool's manifest declares the packages.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum WorkspaceKind {
    /// `workspaces` of the root `package.json`.
    Npm,
    /// `pnpm-workspace.yaml`.
    Pnpm,
    /// `packages` of `lerna.json`.
    Lerna,
    /// `go.work`.
    GoWork,
    /// `[tool.uv.workspace]` of the root `pyproject.toml`.
    Uv,
    /// The `project.json` files of an Nx workspace (`nx.json` at the root).
    Nx,
    /// `workspace` of the root `deno.json` or `deno.jsonc`.
    Deno,
}

/// The packages of the repository, one row per package, sorted by folder.
/// A package is a folder that matches a declaration, has its manifest and
/// holds an analyzed file; the root (folder 0) when a declaration lists it.
/// In a language no [`Workspace`] declares (JavaScript, Go, Python), a
/// folder with its manifest and production code is an implicit package,
/// the root included, when the repository has at least two packages in
/// all; under a root project, one of the same language is its satellite
/// (a library's site), except a Go module. A package can lie inside another (a Go module in a module, the
/// members of a root package): each file belongs to the deepest package
/// that holds it. Empty for a repository of a single project.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Packages {
    pub dir: Vec<u32>,
    /// The name its manifest gives, or its folder's.
    pub name: Vec<String>,
    pub kind: Vec<PackageKind>,
    pub framework: Vec<Option<Framework>>,
    /// Its `package.json`, `pyproject.toml` or `go.mod`, when it has one.
    pub manifest: Vec<Option<u32>>,
    /// Its row in [`PackageGroups`].
    pub group: Vec<Option<u32>>,
    /// Production files in an analyzed language.
    pub code_files: Vec<u32>,
    /// The file it starts from: by its framework's convention, or the
    /// `main` of its manifest.
    pub entry: Vec<Option<u32>>,
    /// The folder of its routes, for a framework that routes by files.
    pub routes: Vec<Option<u32>>,
    /// Files under [`Packages::routes`], API routes included.
    pub route_count: Vec<u32>,
    /// Of them, the routes that answer HTTP requests with data.
    pub api_route_count: Vec<u32>,
}

/// What a package is for, by what it runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PackageKind {
    /// Something that runs: a `start` script, a platform manifest, or a
    /// framework's entry.
    App,
    /// Code for other packages.
    Library,
}

/// The framework a package is built with, read from the dependencies it
/// declares (never its peer dependencies).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Framework {
    Nextjs,
    Nestjs,
    ReactNative,
    Storybook,
    Fastify,
    Express,
    Fastapi,
    Django,
    Flask,
    /// A `manifest.json` with a `manifest_version`.
    BrowserExtension,
}

/// Packages that share a prefix in their names (`acme-api`, `acme-web`),
/// one row per prefix, sorted. A prefix groups three packages or more, or
/// two that import one another; the package named after the prefix joins
/// its group.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PackageGroups {
    pub prefix: Vec<String>,
    /// Whether a production import joins two packages of the group: if
    /// not, only the names do.
    pub linked: Vec<bool>,
}

/// Dependencies the production code imports, one row per package and
/// dependency, sorted by package (`null`, outside any package, first), then
/// by name. Only dependencies a manifest declares count, so the standard
/// library does not.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Externals {
    pub package: Vec<Option<u32>>,
    /// As the manifest declares it: `@nestjs/core`, `pydantic`,
    /// `github.com/gin-gonic/gin`.
    pub name: Vec<String>,
    /// Production files that import it.
    pub files: Vec<u32>,
}

/// Where everything stands in the city: the plateau of each island, the
/// parcel of each folder and the lot of each file.
///
/// Lengths are in tenths of a city unit (`u`; a lot is 2 × 2 u, so 20 × 20),
/// x to the east and y to the north, from the south-west corner of the city.
/// Rectangles are given by their south-west corner and their size.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Layout {
    pub width: u32,
    pub height: u32,
    /// The plateau of each island, one row per island.
    pub islands: Rects,
    pub parcels: Parcels,
    pub grids: Grids,
    /// The centre of each file's lot, one row per file.
    pub lots: Lots,
}

/// Rectangles, one row each.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Rects {
    pub x: Vec<u32>,
    pub y: Vec<u32>,
    pub width: Vec<u32>,
    pub height: Vec<u32>,
}

/// The parcels of the city, one row per folder inside an island, sorted by
/// folder. A parcel holds its folder's whole subtree: the parcels of its
/// subfolders and the grid of its own files. The folder an island is named
/// after has no parcel: its plateau plays that part.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Parcels {
    pub dir: Vec<u32>,
    pub x: Vec<u32>,
    pub y: Vec<u32>,
    pub width: Vec<u32>,
    pub height: Vec<u32>,
    pub nature: Vec<ParcelNature>,
}

/// What most files of a parcel's subtree, or of a grid, are.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ParcelNature {
    Normal,
    /// More than half are tests or test fixtures, and no more than half
    /// unanalyzed: a park.
    Tests,
    /// More than half are in a language the analyzer does not read, tests
    /// or not: concrete, as their buildings are.
    Unanalyzed,
}

/// The grids of lots, one row per folder that holds files of its own,
/// sorted by folder. A grid lies in its folder's parcel, or on the plateau
/// for the folder an island is named after. Lots without a file stay empty.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Grids {
    pub dir: Vec<u32>,
    pub x: Vec<u32>,
    pub y: Vec<u32>,
    pub columns: Vec<u32>,
    pub rows: Vec<u32>,
    /// What most of the folder's own files are: the ground under the grid.
    pub nature: Vec<ParcelNature>,
}

/// Points, one row each.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Lots {
    pub x: Vec<u32>,
    pub y: Vec<u32>,
}

/// The guided tour of the city: the steps that have something measured to
/// show, in the order they are shown. Steps hold what they point at and the
/// numbers their sentences quote; the sentences themselves are the web
/// app's.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Tour {
    /// Always starts with [`TourStep::Overview`]; the other kinds come at
    /// most once each, in the order of [`TourStep`]. A monorepo's tour
    /// presents its packages, from [`TourStep::Applications`] to
    /// [`TourStep::InsidePackage`]; another repository's presents its files,
    /// from [`TourStep::EntryPoints`] to [`TourStep::Foundations`]. A tour
    /// never mixes the two.
    pub steps: Vec<TourStep>,
}

/// One step of the tour. Lists of files and roles hold one to three rows,
/// the first first; lists of packages hold what their step says.
/// Production files are [`Scope::Source`] files that are not generated.
/// The production imports of a package are those of its production files.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum TourStep {
    /// The whole city.
    Overview {
        /// Files shown in the city, generated ones left out.
        files: u32,
        /// Generated files, counted apart.
        generated: u32,
        /// Lines of production code.
        lines: u32,
        /// The language most of those lines are in, into
        /// [`AnalysisResult::languages`], an unknown extension (`Other`)
        /// never; `null` without production code in a known language.
        language: Option<u32>,
        /// Lines of production code in that language.
        language_lines: u32,
        /// Whether the analyzer reads that language: Rust, for one, is
        /// shown but not parsed.
        language_read: bool,
        /// The island with the most production files; without production
        /// code, the island with the most files.
        biggest_island: Option<u32>,
        /// The island without production code with the most files, such as
        /// `build/` or `test/`.
        outside_island: Option<u32>,
    },
    /// Where the code starts: rows of [`Roles::entries`].
    EntryPoints { entries: Vec<u32> },
    /// What pulls the code together: rows of [`Roles::conductors`], none of
    /// them already shown as an entry point.
    Conductors { conductors: Vec<u32> },
    /// What everything rests on: rows of [`Roles::foundations`].
    Foundations {
        foundations: Vec<u32>,
        /// The island that holds most of the foundations, when it holds two
        /// or more.
        island: Option<u32>,
    },
    /// The main apps of a monorepo its apps lead: its groups of apps by
    /// name and its apps outside a group, the largest first, from one to
    /// five.
    Applications {
        units: Vec<AppUnit>,
        /// Code files of all the apps, to give each unit its share.
        app_files: u32,
    },
    /// The other apps, two or more: rows of [`Packages`], the largest first.
    /// In a monorepo of libraries, without [`TourStep::Applications`], all
    /// its apps, one or more.
    OtherApps { apps: Vec<u32> },
    /// The libraries of a monorepo and the packages that import them.
    Libraries {
        /// The libraries the most packages import, one to four, the first
        /// first.
        most_imported: Vec<u32>,
        /// For each of them, how many packages import it.
        importers: Vec<u32>,
        /// The library with the most code files.
        largest: u32,
        /// Libraries that one app imports and no other package, when apps
        /// lead the monorepo.
        single_app: Vec<u32>,
        /// Libraries no package imports, when apps lead the monorepo: in a
        /// monorepo of libraries, the libraries at the top are imported by
        /// no package by design.
        unused: Vec<u32>,
    },
    /// What the apps share, beyond the most imported libraries.
    AppLinks {
        /// Production imports from an app to another app.
        app_imports: u32,
        /// One to three libraries that apps of different units import.
        shared: Vec<SharedLibrary>,
    },
    /// The layers of the islands, read from [`Islands::layer`], and how the
    /// imports between islands in layers follow them: [`Links::imports`]
    /// and [`Links::upward`]. In a monorepo, [`Links::production`] and
    /// [`Links::production_upward`] instead, and the step is shown when at
    /// most 10% of them go up.
    Layers {
        /// Imports to an island of a lower layer.
        down: u32,
        /// Imports to another island of the same layer.
        level: u32,
        /// Imports to an island of a higher layer.
        up: u32,
        /// The row of [`Links`] with the most of those imports going up;
        /// `null` when none does.
        worst_link: Option<u32>,
    },
    /// In a monorepo of libraries, the folders outside the packages whose
    /// examples and tests import them.
    Consumers {
        /// One to three folders at the top of the repository, the one with
        /// the most imports first.
        folders: Vec<Consumer>,
        /// The package they import the most.
        package: u32,
    },
    /// Inside the package that stands for the monorepo: the app that holds
    /// most of the apps' code, or the main library of a monorepo of
    /// libraries.
    InsidePackage {
        /// A row of [`Packages`].
        package: u32,
        /// Its largest folders, one to three, the first first.
        dirs: Vec<u32>,
        /// Code files of each.
        files: Vec<u32>,
    },
    /// The largest loop of imports.
    Cycles {
        /// A row of [`Cycles`].
        cycle: u32,
        /// The deepest folder that holds all its files.
        dir: u32,
        /// In a monorepo, the package that holds it.
        package: Option<u32>,
        /// Loops inside that package, this one included.
        in_package: u32,
        /// In a monorepo, loops whose files lie in two packages or more.
        crossing: u32,
    },
    /// The most complex production files that other files import, each in
    /// its own folder; in a monorepo, each in its own main unit of apps, or
    /// its own package when apps do not lead the monorepo.
    ComplexAreas {
        files: Vec<u32>,
        /// Complexity of all the production code, to give their share.
        complexity: u32,
    },
    /// What is not production code.
    Rest {
        /// Files of tests and test fixtures.
        tests: u32,
        examples: u32,
        docs: u32,
        config: u32,
        /// Configuration files at the root of the repository.
        root_config: u32,
        /// Folders shown as parks that are not inside another park.
        park_count: u32,
        /// Files of tests and test fixtures in those parks: the others
        /// stand among the code.
        park_tests: u32,
        /// The parks with the most tests: none to three, unlike the other
        /// lists.
        parks: Vec<u32>,
    },
}

/// Apps presented together: the apps of a group by name, or one app outside
/// a group.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppUnit {
    /// A row of [`PackageGroups`]; `null` for an app outside a group.
    pub group: Option<u32>,
    /// Rows of [`Packages`], the largest first.
    pub apps: Vec<u32>,
    /// Code files of those apps.
    pub files: u32,
}

/// A library that apps of different units import.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SharedLibrary {
    /// A row of [`Packages`].
    pub library: u32,
    /// The apps that import it, two or more, the one with the most
    /// importing files first.
    pub apps: Vec<u32>,
    /// Production files of those apps that import it.
    pub files: u32,
    /// Of them, files that import only its types.
    pub type_only: u32,
}

/// A folder outside the packages whose examples or tests import them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Consumer {
    pub dir: u32,
    /// Its subfolders that import a package, such as one per example.
    pub folders: u32,
    /// Imports of a package from its files.
    pub imports: u32,
}

/// Counts that describe the analysis itself.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Stats {
    /// Files dropped at ingestion, by reason. They are not in [`Files`].
    pub ignored: Ignored,
    /// Imports found in the analyzed files, before several imports of the
    /// same target are merged into one edge.
    pub imports_total: u32,
    /// Imports resolved to a file or folder of the repository.
    pub imports_resolved: u32,
    /// Imports of a dependency that is not in the repository. The rest of
    /// the imports could not be resolved.
    pub imports_external: u32,
}

/// Files dropped at ingestion, by reason.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Ignored {
    pub vendored: u32,
    pub minified: u32,
    pub binary: u32,
    /// More folders deep than the analyzer indexes.
    pub deep: u32,
}

impl Ignored {
    /// All the files dropped, whatever the reason.
    pub fn total(&self) -> u32 {
        // Every field named, so a new reason cannot be left out of the sum.
        let Self {
            vendored,
            minified,
            binary,
            deep,
        } = *self;
        vendored
            .saturating_add(minified)
            .saturating_add(binary)
            .saturating_add(deep)
    }
}
