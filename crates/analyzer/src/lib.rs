//! Pure analysis core: turns in-memory files into an analysis result, without any I/O.

#![forbid(unsafe_code)]

mod analyze;
mod entries;
pub mod files;
pub mod graph;
mod islands;
pub mod lang;
mod metrics;
mod reach;
mod resolve;
mod roles;
mod scope;

pub use analyze::{ANALYZER_VERSION, ImportReport, Report, analyze, analyze_with_report};
pub use roles::RolesReport;

/// Counts and indexes are `u32` in the result: far more than ingestion keeps.
fn saturating_u32(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}
