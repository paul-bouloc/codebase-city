//! Go.
//!
//! A file exports its top-level functions, types, constants and variables
//! whose name starts with an upper-case letter. Methods belong to their
//! type and are left out.
//!
//! An import names a package, that is a folder; the specifier is its path.

use model::{EdgeKind, SymbolKind};
use tree_sitter::Node;

use super::{Import, Symbol, children, header, line, symbol, text};

pub(super) fn is_decision(node: Node<'_>) -> bool {
    match node.kind() {
        "if_statement" | "for_statement" | "expression_case" | "type_case"
        | "communication_case" => true,
        "binary_expression" => node
            .child_by_field_name("operator")
            .is_some_and(|operator| matches!(operator.kind(), "&&" | "||")),
        _ => false,
    }
}

pub(super) fn symbols(root: Node<'_>, source: &[u8]) -> Vec<Symbol> {
    let mut declared = Vec::new();
    for node in children(root) {
        match node.kind() {
            "function_declaration" => {
                declared.extend(
                    node.child_by_field_name("name")
                        .map(|name| (name, SymbolKind::Function)),
                );
            }
            "type_declaration" => {
                for spec in children(node) {
                    let (Some(name), Some(definition)) = (
                        spec.child_by_field_name("name"),
                        spec.child_by_field_name("type"),
                    ) else {
                        continue;
                    };
                    let kind = match (spec.kind(), definition.kind()) {
                        ("type_spec", "struct_type") => SymbolKind::Class,
                        ("type_spec", "interface_type") => SymbolKind::Interface,
                        _ => SymbolKind::Type,
                    };
                    declared.push((name, kind));
                }
            }
            "const_declaration" | "var_declaration" => {
                for spec in value_specs(node) {
                    let mut cursor = spec.walk();
                    declared.extend(
                        spec.children_by_field_name("name", &mut cursor)
                            .map(|name| (name, SymbolKind::Constant)),
                    );
                }
            }
            _ => {}
        }
    }
    declared
        .into_iter()
        .filter(|&(name, _)| text(name, source).starts_with(char::is_uppercase))
        .map(|(name, kind)| symbol(name, kind, source))
        .collect()
}

/// The comment of the package: the first block of comments before the
/// package clause that is not a license, a build constraint or the
/// "Code generated" line.
/// Whether the file is part of a program: `package main` with a top-level
/// `func main`.
pub(super) fn is_main(root: Node<'_>, source: &[u8]) -> bool {
    let nodes = children(root);
    let in_main = nodes.iter().any(|node| {
        node.kind() == "package_clause"
            && children(*node)
                .first()
                .is_some_and(|name| text(*name, source) == "main")
    });
    in_main
        && nodes.iter().any(|node| {
            node.kind() == "function_declaration"
                && node
                    .child_by_field_name("name")
                    .is_some_and(|name| text(name, source) == "main")
        })
}

pub(super) fn header(root: Node<'_>, source: &[u8]) -> Option<String> {
    let comments: Vec<_> = children(root)
        .into_iter()
        .take_while(|node| node.kind() == "comment")
        .collect();
    header::pick(&comments, source)
}

/// The `const_spec` and `var_spec` of a declaration, grouped or not.
fn value_specs(declaration: Node<'_>) -> Vec<Node<'_>> {
    children(declaration)
        .into_iter()
        .flat_map(|child| match child.kind() {
            "var_spec_list" => children(child),
            _ => vec![child],
        })
        .filter(|spec| matches!(spec.kind(), "const_spec" | "var_spec"))
        .collect()
}

pub(super) fn imports(root: Node<'_>, source: &[u8]) -> Vec<Import> {
    children(root)
        .into_iter()
        .filter(|node| node.kind() == "import_declaration")
        .flat_map(children)
        .flat_map(|child| match child.kind() {
            "import_spec_list" => children(child),
            _ => vec![child],
        })
        .filter(|spec| spec.kind() == "import_spec")
        .filter_map(|spec| {
            let path = spec.child_by_field_name("path")?;
            let quoted = text(path, source);
            let specifier = quoted.get(1..quoted.len().checked_sub(1)?)?;
            // `import "C"` is cgo, not a package
            (!specifier.is_empty() && specifier != "C").then(|| Import {
                specifier: specifier.to_owned(),
                kind: EdgeKind::Import,
                line: line(spec),
                names: Vec::new(),
                exports: Vec::new(),
            })
        })
        .collect()
}
