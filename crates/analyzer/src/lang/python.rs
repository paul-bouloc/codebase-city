//! Python.
//!
//! A module exports the names listed in a literal `__all__`, or else its
//! top-level functions and classes whose name does not start with `_`.
//!
//! Imports are `import a.b` and `from a.b import c`, relative or not,
//! wherever they are.

use std::collections::HashMap;

use model::{EdgeKind, SymbolKind};
use tree_sitter::Node;

use super::{Import, Symbol, children, has_ancestor, header, line, symbol, text, walk};

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
            // The first definition wins: `f = wrap(f)` keeps `f` a function
            let mut by_name = HashMap::new();
            for (name, kind) in defined {
                by_name.entry(text(name, source)).or_insert((name, kind));
            }
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

pub(super) fn imports(path: &str, root: Node<'_>, source: &[u8]) -> Vec<Import> {
    let in_init = path == "__init__.py" || path.ends_with("/__init__.py");
    let mut imports = Vec::new();
    walk(root, |node| {
        match node.kind() {
            "import_statement" => {
                let kind = kind(node, source, false);
                let mut cursor = node.walk();
                for name in node.children_by_field_name("name", &mut cursor) {
                    let module = match name.kind() {
                        "aliased_import" => name.child_by_field_name("name"),
                        _ => Some(name),
                    };
                    imports.extend(module.map(|module| Import {
                        specifier: dotted(module, source),
                        kind,
                        line: line(node),
                        names: Vec::new(),
                    }));
                }
            }
            "import_from_statement" => imports.extend(from_import(node, source, in_init)),
            _ => return true,
        }
        false
    });
    imports
}

/// `from a.b import c, d as e`, `from .. import f`, `from .g import *`.
fn from_import(node: Node<'_>, source: &[u8], in_init: bool) -> Option<Import> {
    let module = node.child_by_field_name("module_name")?;
    let relative = module.kind() == "relative_import";
    let mut names = Vec::new();
    let mut cursor = node.walk();
    for name in node.children_by_field_name("name", &mut cursor) {
        let name = match name.kind() {
            "aliased_import" => name.child_by_field_name("name"),
            _ => Some(name),
        };
        names.extend(name.map(|name| dotted(name, source)));
    }
    if children(node)
        .iter()
        .any(|child| child.kind() == "wildcard_import")
    {
        names.push("*".to_owned());
    }
    Some(Import {
        specifier: dotted(module, source),
        // A package re-exports what its `__init__.py` imports from its own modules
        kind: kind(node, source, in_init && relative),
        line: line(node),
        names,
    })
}

/// What an import statement is, from where it stands.
fn kind(node: Node<'_>, source: &[u8], reexport: bool) -> EdgeKind {
    if under_type_checking(node, source) {
        EdgeKind::Type
    } else if has_ancestor(node, &["function_definition"]) {
        EdgeKind::Lazy
    } else if reexport {
        EdgeKind::Reexport
    } else {
        EdgeKind::Import
    }
}

/// Inside the body of `if TYPE_CHECKING:`, which only type checkers run.
fn under_type_checking(node: Node<'_>, source: &[u8]) -> bool {
    let mut child = node;
    while let Some(parent) = child.parent() {
        if parent.kind() == "if_statement"
            && parent.child_by_field_name("consequence") == Some(child)
            && parent
                .child_by_field_name("condition")
                .is_some_and(|condition| {
                    matches!(
                        text(condition, source).as_str(),
                        "TYPE_CHECKING" | "typing.TYPE_CHECKING"
                    )
                })
        {
            return true;
        }
        child = parent;
    }
    false
}

/// A module or name as written, without the spaces Python allows in it
/// (`from . import x`, `a . b`).
fn dotted(node: Node<'_>, source: &[u8]) -> String {
    text(node, source).split_whitespace().collect()
}
