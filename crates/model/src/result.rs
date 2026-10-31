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
pub const FORMAT_VERSION: u32 = 2;

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
    /// Cyclomatic complexity; `null` when the language is not analyzed.
    pub complexity: Vec<Option<u32>>,
    /// Generated code: shown in the city, left out of every ranking.
    pub generated: Vec<bool>,
    /// The file's leading comment or docstring, verbatim, a license block
    /// skipped; `null` when there is none or the language is not analyzed.
    pub header: Vec<Option<String>>,
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
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

/// Resolved imports between files, one row per import.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Edges {
    /// Index of the importing file.
    pub from: Vec<u32>,
    /// Index of the imported file.
    pub to: Vec<u32>,
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

/// Counts that describe the analysis itself.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Stats {
    /// Files dropped at ingestion, by reason. They are not in [`Files`].
    pub ignored: Ignored,
    /// Imports found in the analyzed files.
    pub imports_total: u32,
    /// Imports resolved to a file of the repository; the rest point outside
    /// it or could not be resolved.
    pub imports_resolved: u32,
}

/// Files dropped at ingestion, by reason.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Ignored {
    pub vendored: u32,
    pub minified: u32,
    pub binary: u32,
}
