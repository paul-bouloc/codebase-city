//! Types of the analysis result, shared by the analyzer, the server and the web app.
//!
//! The TypeScript types in `web/src/data/generated/` are generated from these
//! by `ts-rs` whenever the tests run (`just gen-types`).

#![forbid(unsafe_code)]

mod result;
mod validate;

pub use result::{
    AnalysisResult, Confidence, Cycles, Dirs, EdgeKind, Edges, Entries, EntryReason, Externals,
    FORMAT_VERSION, Files, Framework, Grids, Ignored, Islands, Layout, Links, Lots, PackageGroups,
    PackageKind, Packages, ParcelNature, Parcels, Ranked, Rects, Repo, Roles, Scope, Stats,
    SymbolKind, Symbols, Tour, TourStep, Workspace, WorkspaceKind,
};
pub use validate::InvalidResult;
