//! Pure analysis core: turns in-memory files into an analysis result, without any I/O.

#![forbid(unsafe_code)]

mod analyze;
pub mod files;
pub mod lang;
mod metrics;

pub use analyze::{ANALYZER_VERSION, analyze};
