//! Pure analysis core: turns in-memory files into an analysis result, without any I/O.

#![forbid(unsafe_code)]

#[cfg(test)]
mod tests {
    #[test]
    fn test_suite_runs() {
        assert_eq!(env!("CARGO_PKG_NAME"), "analyzer");
    }
}
