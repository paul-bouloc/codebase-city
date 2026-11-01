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

use crate::files::split_path;

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

/// Only a package's `__init__.py` can be a barrel: its imports from its
/// own modules re-export, while `__all__`, the docstring and other imports
/// are neutral.
pub(super) fn statements(path: &str, root: Node<'_>, source: &[u8]) -> (u32, u32) {
    if !is_init(path) {
        return (0, 0);
    }
    let mut statements = 0;
    let mut reexports = 0;
    for node in children(root) {
        match node.kind() {
            "comment" | "import_statement" | "future_import_statement" => {}
            "import_from_statement" => {
                if node
                    .child_by_field_name("module_name")
                    .is_some_and(|module| from_own_package(path, module, source))
                {
                    statements += 1;
                    reexports += 1;
                }
            }
            "expression_statement" if docstring(node, source).is_some() => {}
            "expression_statement" if dunder_all(node, source).is_some() => {}
            _ => statements += 1,
        }
    }
    (statements, reexports)
}

/// Whether the module runs something when started as a script: a top-level
/// `if __name__ == "__main__":`, either way round, with either quotes, in
/// parentheses or not.
pub(super) fn is_main(root: Node<'_>, source: &[u8]) -> bool {
    children(root).into_iter().any(|node| {
        node.kind() == "if_statement"
            && node
                .child_by_field_name("condition")
                .is_some_and(|mut condition| {
                    while condition.kind() == "parenthesized_expression"
                        && let Some(inner) = children(condition).first()
                    {
                        condition = *inner;
                    }
                    let condition: String = text(condition, source)
                        .chars()
                        .filter(|c| !c.is_whitespace())
                        .map(|c| if c == '\'' { '"' } else { c })
                        .collect();
                    condition == r#"__name__=="__main__""# || condition == r#""__main__"==__name__"#
                })
    })
}

fn is_init(path: &str) -> bool {
    path == "__init__.py" || path.ends_with("/__init__.py")
}

/// Whether the module of a `from … import` in the `__init__.py` at `path`
/// is the package itself or one of its modules: `.docks`, or
/// `harbor.docks` in `harbor/__init__.py` (and in `src/harbor/__init__.py`,
/// whatever the root).
fn from_own_package(path: &str, module: Node<'_>, source: &[u8]) -> bool {
    if module.kind() == "relative_import" {
        return true;
    }
    let module = dotted(module, source);
    let package: Vec<&str> = split_path(path)
        .0
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    (0..package.len()).any(|start| {
        let own = package[start..].join(".");
        module == own
            || module
                .strip_prefix(&own)
                .is_some_and(|rest| rest.starts_with('.'))
    })
}

pub(super) fn imports(path: &str, root: Node<'_>, source: &[u8]) -> Vec<Import> {
    let in_init = is_init(path);
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
                        exports: Vec::new(),
                    }));
                }
            }
            "import_from_statement" => imports.extend(from_import(path, node, source, in_init)),
            _ => return true,
        }
        false
    });
    imports
}

/// `from a.b import c, d as e`, `from .. import f`, `from .g import *`.
fn from_import(path: &str, node: Node<'_>, source: &[u8], in_init: bool) -> Option<Import> {
    let module = node.child_by_field_name("module_name")?;
    let own = in_init && from_own_package(path, module, source);
    let mut names = Vec::new();
    let mut bound = Vec::new();
    let mut cursor = node.walk();
    for name in node.children_by_field_name("name", &mut cursor) {
        let (name, alias) = match name.kind() {
            "aliased_import" => (
                name.child_by_field_name("name"),
                name.child_by_field_name("alias"),
            ),
            _ => (Some(name), None),
        };
        if let Some(name) = name {
            names.push(dotted(name, source));
            bound.push(dotted(alias.unwrap_or(name), source));
        }
    }
    if children(node)
        .iter()
        .any(|child| child.kind() == "wildcard_import")
    {
        names.push("*".to_owned());
        bound.push("*".to_owned());
    }
    // A package re-exports what its `__init__.py` imports from its own modules
    let kind = kind(node, source, own);
    Some(Import {
        specifier: dotted(module, source),
        kind,
        line: line(node),
        names,
        exports: if kind == EdgeKind::Reexport {
            bound
        } else {
            Vec::new()
        },
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
