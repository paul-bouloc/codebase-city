//! Python.
//!
//! A module exports the names listed in a literal `__all__`, or else its
//! top-level functions and classes whose name does not start with `_`.

use std::collections::HashMap;

use model::SymbolKind;
use tree_sitter::Node;

use super::{Symbol, children, header, symbol, text};

pub(super) fn is_decision(node: Node<'_>) -> bool {
    match node.kind() {
        "if_statement"
        | "elif_clause"
        | "for_statement"
        | "while_statement"
        | "except_clause"
        | "conditional_expression"
        | "boolean_operator"
        | "for_in_clause"
        | "if_clause" => true,
        // `case _:` is the `default` of other languages, which is not counted
        "case_clause" => !is_wildcard_case(node),
        _ => false,
    }
}

/// `case _:`, without a guard: its only pattern has nothing in it.
fn is_wildcard_case(node: Node<'_>) -> bool {
    let patterns: Vec<_> = children(node)
        .into_iter()
        .filter(|child| child.kind() == "case_pattern")
        .collect();
    node.child_by_field_name("guard").is_none()
        && patterns.len() == 1
        && patterns[0].named_child_count() == 0
}

pub(super) fn symbols(root: Node<'_>, source: &[u8]) -> Vec<Symbol> {
    let mut defined = Vec::new();
    let mut all = None;
    for node in children(root) {
        if let Some(names) = dunder_all(node, source) {
            all = Some(names);
        }
        defined.extend(definitions(node));
    }

    match all {
        Some(names) => {
            let by_name: HashMap<_, _> = defined
                .into_iter()
                .map(|(name, kind)| (text(name, source), (name, kind)))
                .collect();
            names
                .iter()
                .filter_map(|wanted| by_name.get(wanted))
                .map(|&(name, kind)| symbol(name, kind, source))
                .collect()
        }
        None => defined
            .into_iter()
            .filter(|&(name, kind)| {
                kind != SymbolKind::Constant && !text(name, source).starts_with('_')
            })
            .map(|(name, kind)| symbol(name, kind, source))
            .collect(),
    }
}

/// The module docstring, or else its first block of comments.
pub(super) fn header(root: Node<'_>, source: &[u8]) -> Option<String> {
    let mut comments = Vec::new();
    for node in children(root) {
        match node.kind() {
            "comment" => {
                if !is_shebang_or_encoding(node, source) {
                    comments.push(node);
                }
            }
            "expression_statement" => {
                if let Some(docstring) = docstring(node, source)
                    && !header::is_license(&docstring)
                {
                    return Some(header::cap(&docstring));
                }
                break;
            }
            _ => break,
        }
    }
    header::pick(&comments, source)
}

/// The names a top-level statement defines, with their kind.
fn definitions(node: Node<'_>) -> Vec<(Node<'_>, SymbolKind)> {
    let kind = match node.kind() {
        "function_definition" => SymbolKind::Function,
        "class_definition" => SymbolKind::Class,
        "decorated_definition" => {
            return node
                .child_by_field_name("definition")
                .map(definitions)
                .unwrap_or_default();
        }
        "expression_statement" => {
            return node
                .named_child(0)
                .filter(|assignment| assignment.kind() == "assignment")
                .and_then(|assignment| assignment.child_by_field_name("left"))
                .filter(|left| left.kind() == "identifier")
                .map(|left| vec![(left, SymbolKind::Constant)])
                .unwrap_or_default();
        }
        _ => return Vec::new(),
    };
    node.child_by_field_name("name")
        .map(|name| vec![(name, kind)])
        .unwrap_or_default()
}

/// The names of `__all__ = [...]` or `(...)`, when every item is a plain
/// string; `None` for any other statement.
fn dunder_all(node: Node<'_>, source: &[u8]) -> Option<Vec<String>> {
    let assignment = node
        .named_child(0)
        .filter(|_| node.kind() == "expression_statement")?;
    if assignment.kind() != "assignment" {
        return None;
    }
    let left = assignment.child_by_field_name("left")?;
    if text(left, source) != "__all__" {
        return None;
    }
    let right = assignment.child_by_field_name("right")?;
    if !matches!(right.kind(), "list" | "tuple") {
        return None;
    }
    children(right)
        .into_iter()
        .filter(|item| item.kind() != "comment")
        .map(|item| plain_string(item, source))
        .collect()
}

/// The content of a string literal without interpolation.
fn plain_string(node: Node<'_>, source: &[u8]) -> Option<String> {
    if node.kind() != "string" {
        return None;
    }
    let mut content = String::new();
    for part in children(node) {
        match part.kind() {
            "string_start" | "string_end" => {}
            "string_content" => content.push_str(&text(part, source)),
            _ => return None,
        }
    }
    Some(content)
}

/// The text of a statement made of a single string, verbatim.
fn docstring(statement: Node<'_>, source: &[u8]) -> Option<String> {
    let string = statement.named_child(0)?;
    (statement.named_child_count() == 1 && string.kind() == "string").then(|| text(string, source))
}

/// The shebang, on the first line, or the encoding declaration of PEP 263,
/// on the first or second line (`# -*- coding: utf-8 -*-`, `# vim: set
/// fileencoding=utf-8`).
fn is_shebang_or_encoding(comment: Node<'_>, source: &[u8]) -> bool {
    let row = comment.start_position().row;
    let text = text(comment, source);
    (row == 0 && text.starts_with("#!")) || (row <= 1 && declares_encoding(&text))
}

/// `coding`, then `:` or `=`, then an encoding name, as PEP 263 reads it.
fn declares_encoding(comment: &str) -> bool {
    comment.match_indices("coding").any(|(start, _)| {
        let rest = &comment[start + "coding".len()..];
        let Some(rest) = rest.strip_prefix([':', '=']) else {
            return false;
        };
        rest.trim_start_matches([' ', '\t'])
            .starts_with(|c: char| c.is_ascii_alphanumeric() || "-_.".contains(c))
    })
}
