//! Pure analysis core: turns in-memory files into an analysis result, without any I/O.

#![forbid(unsafe_code)]

mod analyze;
pub mod files;
pub mod lang;
mod metrics;

pub use analyze::{ANALYZER_VERSION, analyze};

/// Counts and indexes are `u32` in the result: far more than ingestion keeps.
fn saturating_u32(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}
