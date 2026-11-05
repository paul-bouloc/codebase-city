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
pub const FORMAT_VERSION: u32 = 8;

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
    pub layout: Layout,
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

/// What the import graph says about the production code (P9): where it
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
    /// island mostly imports islands of lower layers. `null` for an island
    /// without production code.
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

/// What most files of a parcel's subtree are.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ParcelNature {
    Normal,
    /// More than half are tests or test fixtures: a park.
    Tests,
    /// More than half are in a language the analyzer does not read.
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
}

/// Points, one row each.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Lots {
    pub x: Vec<u32>,
    pub y: Vec<u32>,
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
