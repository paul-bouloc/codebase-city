//! Types of the analysis result, shared by the analyzer, the server and the web app.
//!
//! The TypeScript types in `web/src/data/generated/` are generated from these
//! by `ts-rs` whenever the tests run (`just gen-types`).

#![forbid(unsafe_code)]

mod result;
mod validate;

pub use result::{
    AnalysisResult, Confidence, Dirs, EdgeKind, Edges, FORMAT_VERSION, Files, Ignored, Repo, Scope,
    Stats, SymbolKind, Symbols,
};
pub use validate::InvalidResult;
