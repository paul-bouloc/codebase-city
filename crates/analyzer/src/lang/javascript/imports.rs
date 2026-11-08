//! The imports of TypeScript and JavaScript: ES `import` and
//! `export … from`, TypeScript's `import x = require()`, and `require()`
//! and `import()` with a literal module, wherever they are.

use model::EdgeKind;
use tree_sitter::Node;

use super::has_token;
use crate::lang::{Import, children, has_ancestor, line, text, walk};

/// Nodes whose body runs when called, not when the module loads.
const FUNCTIONS: &[&str] = &[
    "function_declaration",
    "function_expression",
    "function",
    "generator_function_declaration",
    "generator_function",
    "arrow_function",
    "method_definition",
];

pub(in crate::lang) fn imports(root: Node<'_>, source: &[u8]) -> Vec<Import> {
    let mut imports = Vec::new();
    walk(root, |node| match node.kind() {
        "import_statement" => {
            imports.extend(es_import(node, source));
            false
        }
        "export_statement" if node.child_by_field_name("source").is_some() => {
            imports.extend(reexport(node, source));
            false
        }
        "call_expression" => {
            imports.extend(call(node, source));
            true
        }
        _ => true,
    });
    imports
}

/// `import … from "m"`, `import "m"` and `import x = require("m")`.
fn es_import(node: Node<'_>, source: &[u8]) -> Option<Import> {
    let require = children(node)
        .into_iter()
        .find(|child| child.kind() == "import_require_clause");
    let module = match require {
        Some(clause) => clause.child_by_field_name("source"),
        None => node.child_by_field_name("source"),
    }?;
    let mut names = Vec::new();
    // `import { type A, type B }` imports types only, like `import type`
    let mut all_types = true;
    let clause = children(node)
        .into_iter()
        .find(|child| child.kind() == "import_clause");
    for part in clause.map(children).unwrap_or_default() {
        match part.kind() {
            "identifier" => {
                names.push("default".to_owned());
                all_types = false;
            }
            "namespace_import" => {
                names.push("*".to_owned());
                all_types = false;
            }
            "named_imports" => {
                for specifier in children(part) {
                    let Some(name) = specifier.child_by_field_name("name") else {
                        continue;
                    };
                    names.push(text(name, source));
                    all_types &= has_token(specifier, "type");
                }
            }
            _ => {}
        }
    }
    let kind = if has_token(node, "type") || (all_types && !names.is_empty()) {
        EdgeKind::Type
    } else {
        EdgeKind::Import
    };
    Some(Import {
        specifier: literal(module, source)?,
        kind,
        line: line(node),
        names,
        exports: Vec::new(),
    })
}

/// `export … from "m"`.
fn reexport(node: Node<'_>, source: &[u8]) -> Option<Import> {
    let module = node.child_by_field_name("source")?;
    let mut names = Vec::new();
    let mut exports = Vec::new();
    if has_token(node, "*") {
        names.push("*".to_owned());
        exports.push("*".to_owned());
    }
    for child in children(node) {
        match child.kind() {
            // `export * as ns from "m"`
            "namespace_export" => {
                names.push("*".to_owned());
                exports.push(
                    children(child)
                        .first()
                        .map_or_else(|| "*".to_owned(), |name| text(*name, source)),
                );
            }
            "export_clause" => {
                for specifier in children(child) {
                    let Some(name) = specifier.child_by_field_name("name") else {
                        continue;
                    };
                    let alias = specifier.child_by_field_name("alias").unwrap_or(name);
                    names.push(text(name, source));
                    exports.push(text(alias, source));
                }
            }
            _ => {}
        }
    }
    let kind = if has_token(node, "type") {
        EdgeKind::Type
    } else {
        EdgeKind::Reexport
    };
    Some(Import {
        specifier: literal(module, source)?,
        kind,
        line: line(node),
        names,
        exports,
    })
}

/// `require("m")` and `import("m")`, with a single literal argument.
fn call(node: Node<'_>, source: &[u8]) -> Option<Import> {
    let function = node.child_by_field_name("function")?;
    let arguments = children(node.child_by_field_name("arguments")?);
    let [module] = arguments.as_slice() else {
        return None;
    };
    let kind = match function.kind() {
        "import" => EdgeKind::Dynamic,
        "identifier" if text(function, source) == "require" => {
            if has_ancestor(node, FUNCTIONS) {
                EdgeKind::Lazy
            } else {
                EdgeKind::Import
            }
        }
        _ => return None,
    };
    Some(Import {
        specifier: literal(*module, source)?,
        kind,
        line: line(node),
        names: Vec::new(),
        exports: Vec::new(),
    })
}

/// The content of a string, or of a template without substitution; `None`
/// for anything computed.
fn literal(node: Node<'_>, source: &[u8]) -> Option<String> {
    let computed = children(node)
        .iter()
        .any(|part| part.kind() == "template_substitution");
    if !matches!(node.kind(), "string" | "template_string") || computed {
        return None;
    }
    let quoted = text(node, source);
    let content = quoted.get(1..quoted.len().checked_sub(1)?)?;
    (!content.is_empty()).then(|| content.to_owned())
}
