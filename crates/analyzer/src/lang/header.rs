//! Picking a file's header among its leading comments: the first block of
//! comments that is neither a license nor a directive for a tool.

use tree_sitter::Node;

/// A header longer than this is cut: the file sheet folds it after 12 lines
/// anyway, and the result stays small.
const MAX_LINES: usize = 60;
const MAX_BYTES: usize = 4096;

/// Comments whose lines all start with one of these, once their markers are
/// removed, are meant for a tool, not for a reader. Case matters: `global `
/// is a directive, `Global state…` is prose.
const DIRECTIVES: &[&str] = &[
    "eslint",
    "tslint",
    "jshint",
    "jslint",
    "global ",
    "@ts-",
    "@flow",
    "istanbul ",
    "prettier-ignore",
    "#region",
    "#endregion",
    "+build",
    "Code generated",
    "noqa",
    "type:",
    "pylint:",
    "mypy:",
    "fmt:",
];

/// Go directives, matched on the raw line: they are written without a space
/// after the slashes (`//go:generate`, `//line file.go:1`).
const RAW_DIRECTIVES: &[&str] = &["//go:", "//line ", "//nolint", "//export "];

/// A block that contains one of these is a license notice.
const LICENSE_PHRASES: &[&str] = &[
    "copyright",
    "spdx-license-identifier",
    "all rights reserved",
    "licensed under",
    "licensed to",
    "released under",
    "mit license",
    "apache license",
    "bsd license",
    "general public license",
    // The URL that ends the Apache notice, sometimes after a blank line
    "/licenses/",
];

/// So is a block with a line that starts with one of these.
const LICENSE_LINE_STARTS: &[&str] = &["license", "licence", "@license"];

/// The header among `comments`, the comments that come before the first
/// statement, in order. Directives are dropped one by one, then the
/// comments left on consecutive lines form one block.
pub(super) fn pick(comments: &[Node<'_>], source: &[u8]) -> Option<String> {
    let text = |start: usize, end: usize| String::from_utf8_lossy(&source[start..end]).into_owned();
    let comments: Vec<_> = comments
        .iter()
        .copied()
        .filter(|comment| !is_directive(&text(comment.start_byte(), comment.end_byte())))
        .collect();
    blocks(&comments)
        .into_iter()
        .map(|(start, end)| text(start, end))
        .find(|block| !is_license(block))
        .map(|block| cap(&block))
}

/// Whether a comment or docstring is a license notice. A comment that only
/// mentions a license (`Validates the license key`) is not one.
pub(super) fn is_license(text: &str) -> bool {
    let lower = text.to_lowercase();
    LICENSE_PHRASES.iter().any(|phrase| lower.contains(phrase))
        || lower.lines().map(strip_markers).any(|line| {
            LICENSE_LINE_STARTS
                .iter()
                .any(|start| line.starts_with(start))
        })
}

/// Normalizes line endings and cuts the text to [`MAX_LINES`] lines and
/// [`MAX_BYTES`] bytes, at a line end when possible.
pub(super) fn cap(text: &str) -> String {
    let mut capped = text.lines().take(MAX_LINES).collect::<Vec<_>>().join("\n");
    if capped.len() > MAX_BYTES {
        let end = capped.floor_char_boundary(MAX_BYTES);
        let end = capped[..end].rfind('\n').unwrap_or(end);
        capped.truncate(end);
    }
    capped
}

/// Byte ranges of the blocks of comments on consecutive lines.
fn blocks(comments: &[Node<'_>]) -> Vec<(usize, usize)> {
    let mut blocks: Vec<(usize, usize)> = Vec::new();
    let mut last_row = None;
    for comment in comments {
        let starts_block = last_row.is_none_or(|row| comment.start_position().row > row + 1);
        match blocks.last_mut() {
            Some(block) if !starts_block => block.1 = comment.end_byte(),
            _ => blocks.push((comment.start_byte(), comment.end_byte())),
        }
        last_row = Some(comment.end_position().row);
    }
    blocks
}

/// A comment meant for a tool: it has text, and every line that is not
/// empty starts with a directive.
fn is_directive(text: &str) -> bool {
    let mut lines = text
        .lines()
        .filter(|line| !strip_markers(line).is_empty())
        .peekable();
    lines.peek().is_some()
        && lines.all(|line| {
            let raw = line.trim();
            let stripped = strip_markers(line);
            RAW_DIRECTIVES
                .iter()
                .any(|directive| raw.starts_with(directive))
                || DIRECTIVES
                    .iter()
                    .any(|directive| stripped.starts_with(directive))
        })
}

/// A comment line without its `//`, `/*`, `*/`, `*` or `#` markers.
fn strip_markers(line: &str) -> &str {
    let line = line.trim();
    let line = line.strip_suffix("*/").unwrap_or(line);
    let line = ["//", "/**", "/*", "*", "#"]
        .iter()
        .find_map(|marker| line.strip_prefix(marker))
        .unwrap_or(line);
    line.trim()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn license_notices_are_recognized() {
        assert!(is_license(
            "/*---\n * Copyright (c) Microsoft Corporation. All rights reserved.\n *---*/"
        ));
        assert!(is_license("// SPDX-License-Identifier: MIT"));
        assert!(is_license("/**\n * @license MIT\n */"));
        assert!(is_license(
            "# Licensed to the Apache Software Foundation (ASF)"
        ));
        assert!(!is_license("// Parses the command line."));
        assert!(!is_license(
            "// Validates the license key entered by the user."
        ));
    }

    #[test]
    fn tool_directives_are_recognized() {
        assert!(is_directive("/* eslint-disable no-console */"));
        assert!(is_directive("// @ts-nocheck\n// @flow"));
        assert!(is_directive("//go:build linux\n// +build linux"));
        assert!(is_directive(
            "// Code generated by protoc-gen-go. DO NOT EDIT."
        ));
        assert!(!is_directive(
            "// eslint-disable-next-line\n// Parses the command line."
        ));
    }

    #[test]
    fn long_headers_are_cut_at_a_line_end() {
        let long = (1..=80)
            .map(|n| format!("// line {n}"))
            .collect::<Vec<_>>()
            .join("\n");
        let capped = cap(&long);
        assert_eq!(capped.lines().count(), MAX_LINES);
        assert!(capped.ends_with("// line 60"));

        let wide = format!("// {}\n// {}", "a".repeat(3000), "b".repeat(3000));
        assert_eq!(cap(&wide), format!("// {}", "a".repeat(3000)));

        let one_line = format!("// {}", "é".repeat(3000));
        let capped = cap(&one_line);
        assert!(capped.len() <= MAX_BYTES);
        assert!(capped.starts_with("// é"));
    }

    #[test]
    fn line_endings_are_normalized() {
        assert_eq!(cap("// a\r\n// b\r\n"), "// a\n// b");
    }
}
