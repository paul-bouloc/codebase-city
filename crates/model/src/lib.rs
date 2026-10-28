//! Types of the analysis result, shared by the analyzer, the server and the web app.

#![forbid(unsafe_code)]

#[cfg(test)]
mod tests {
    #[test]
    fn test_suite_runs() {
        assert_eq!(env!("CARGO_PKG_NAME"), "model");
    }
}
