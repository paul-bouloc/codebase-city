//! TypeScript and JavaScript, with or without JSX.
//!
//! Exports are ES modules (`export …`, `export { … }`, `export default`)
//! and CommonJS (`exports.x = …`, `module.exports = …`). Re-exports from
//! another module are left to the file that declares the symbol.

mod imports;

use std::collections::{HashMap, HashSet};

use model::SymbolKind;
use tree_sitter::Node;

use super::{DefaultExport, Symbol, children, header, symbol, text};
pub(super) use imports::imports;

pub(super) fn is_decision(node: Node<'_>) -> bool {
    match node.kind() {
        "if_statement" | "for_statement" | "for_in_statement" | "while_statement"
        | "do_statement" | "switch_case" | "catch_clause" | "ternary_expression" => true,
        "binary_expression" => node
            .child_by_field_name("operator")
            .is_some_and(|operator| matches!(operator.kind(), "&&" | "||" | "??")),
        _ => false,
    }
}

/// A declaration of the module's top level: its name node and its kind.
type Declared<'tree> = (Node<'tree>, SymbolKind);

pub(super) fn symbols(root: Node<'_>, source: &[u8]) -> Vec<Symbol> {
    let top_level = children(root);
    // `export { a }` may come before `a` is declared
    let mut locals = HashMap::new();
    for node in &top_level {
        let declaration = match node.kind() {
            "export_statement" => node.child_by_field_name("declaration"),
            _ => Some(*node),
        };
        for (name, kind) in declaration.map(declared).unwrap_or_default() {
            locals.insert(text(name, source), (name, kind));
        }
    }

    let mut symbols = Vec::new();
    for node in top_level {
        match node.kind() {
            "export_statement" => exported(node, source, &locals, &mut symbols),
            "expression_statement" => {
                if let Some(assignment) = node.named_child(0) {
                    commonjs(assignment, source, &locals, &mut symbols);
                }
            }
            _ => {}
        }
    }
    symbols
}

/// The first block of comments before the first statement. A block right
/// above a declaration, with no blank line, documents that declaration and
/// is left out; one right above the imports still describes the file.
pub(super) fn header(root: Node<'_>, source: &[u8]) -> Option<String> {
    let mut nodes = children(root)
        .into_iter()
        .skip_while(|node| node.kind() == "hash_bang_line")
        .peekable();
    let mut comments = Vec::new();
    while let Some(comment) =
        nodes.next_if(|node| matches!(node.kind(), "comment" | "html_comment"))
    {
        comments.push(comment);
    }
    if let Some(first) = nodes.next()
        && !is_import(first, source)
    {
        let mut next_row = first.start_position().row;
        while let Some(last) = comments.last()
            && last.end_position().row + 1 >= next_row
        {
            next_row = last.start_position().row;
            comments.pop();
        }
    }
    header::pick(&comments, source)
}

/// An `import`, or a CommonJS `require` at the top level.
fn is_import(node: Node<'_>, source: &[u8]) -> bool {
    match node.kind() {
        "import_statement" => true,
        "lexical_declaration" | "variable_declaration" | "expression_statement" => {
            text(node, source).contains("require(")
        }
        _ => false,
    }
}

/// The names a declaration introduces, with their kind.
fn declared(node: Node<'_>) -> Vec<Declared<'_>> {
    let named = |kind| {
        node.child_by_field_name("name")
            .map(|name| (name, kind))
            .into_iter()
            .collect()
    };
    match node.kind() {
        "function_declaration" | "generator_function_declaration" | "function_signature" => {
            named(SymbolKind::Function)
        }
        "class_declaration" | "abstract_class_declaration" => named(SymbolKind::Class),
        "interface_declaration" => named(SymbolKind::Interface),
        "type_alias_declaration" => named(SymbolKind::Type),
        "enum_declaration" => named(SymbolKind::Enum),
        "lexical_declaration" | "variable_declaration" => children(node)
            .into_iter()
            .filter(|declarator| declarator.kind() == "variable_declarator")
            .filter_map(|declarator| {
                let name = declarator.child_by_field_name("name")?;
                // Destructuring patterns are left out
                let kind = declarator
                    .child_by_field_name("value")
                    .map_or(SymbolKind::Constant, value_kind);
                (name.kind() == "identifier").then_some((name, kind))
            })
            .collect(),
        // `declare function f(): void;`, `declare const x: number;`
        "ambient_declaration" => children(node).into_iter().flat_map(declared).collect(),
        _ => Vec::new(),
    }
}

/// The kind of a symbol bound to this value.
fn value_kind(value: Node<'_>) -> SymbolKind {
    match value.kind() {
        "arrow_function" | "function_expression" | "function" | "generator_function" => {
            SymbolKind::Function
        }
        "class" => SymbolKind::Class,
        _ => SymbolKind::Constant,
    }
}

fn exported(
    node: Node<'_>,
    source: &[u8],
    locals: &HashMap<String, Declared<'_>>,
    symbols: &mut Vec<Symbol>,
) {
    if node.child_by_field_name("source").is_some() {
        return;
    }
    if let Some(declaration) = node.child_by_field_name("declaration") {
        symbols.extend(
            declared(declaration)
                .into_iter()
                .map(|(name, kind)| symbol(name, kind, source)),
        );
        return;
    }
    if let Some(value) = node.child_by_field_name("value") {
        // `export default Name` or a named function or class
        if let Some(found) = bound(value, source, locals) {
            symbols.push(found);
        }
        return;
    }
    let Some(clause) = children(node)
        .into_iter()
        .find(|child| child.kind() == "export_clause")
    else {
        return;
    };
    for specifier in children(clause) {
        let Some(local) = specifier.child_by_field_name("name") else {
            continue;
        };
        let Some(&(name, kind)) = locals.get(&text(local, source)) else {
            continue;
        };
        let alias = specifier
            .child_by_field_name("alias")
            .map(|alias| text(alias, source))
            .filter(|alias| alias != "default");
        let mut found = symbol(name, kind, source);
        if let Some(alias) = alias {
            found.name = alias;
        }
        symbols.push(found);
    }
}

/// The kind of a value, looking up the local it names, if any.
fn kind_of(value: Node<'_>, source: &[u8], locals: &HashMap<String, Declared<'_>>) -> SymbolKind {
    if value.kind() == "identifier" {
        locals
            .get(&text(value, source))
            .map_or(SymbolKind::Constant, |&(_, kind)| kind)
    } else {
        value_kind(value)
    }
}

/// The symbol a value exports: a local it names, or a function or class
/// with a name of its own.
fn bound(value: Node<'_>, source: &[u8], locals: &HashMap<String, Declared<'_>>) -> Option<Symbol> {
    if value.kind() == "identifier" {
        let &(name, kind) = locals.get(&text(value, source))?;
        return Some(symbol(name, kind, source));
    }
    let name = value.child_by_field_name("name")?;
    Some(symbol(name, value_kind(value), source))
}

/// `exports.x = …`, `module.exports.x = …` and `module.exports = …`.
fn commonjs(
    node: Node<'_>,
    source: &[u8],
    locals: &HashMap<String, Declared<'_>>,
    symbols: &mut Vec<Symbol>,
) {
    if node.kind() != "assignment_expression" {
        return;
    }
    let (Some(left), Some(right)) = (
        node.child_by_field_name("left"),
        node.child_by_field_name("right"),
    ) else {
        return;
    };
    // `exports = module.exports = …`
    if right.kind() == "assignment_expression" {
        commonjs(right, source, locals, symbols);
    }
    if is_module_exports(left, source) {
        if right.kind() == "object" {
            for property in children(right) {
                exported_property(property, source, locals, symbols);
            }
        } else if let Some(found) = bound(right, source, locals) {
            symbols.push(found);
        }
        return;
    }
    if left.kind() != "member_expression" {
        return;
    }
    let (Some(object), Some(property)) = (
        left.child_by_field_name("object"),
        left.child_by_field_name("property"),
    ) else {
        return;
    };
    let on_exports = (object.kind() == "identifier" && text(object, source) == "exports")
        || is_module_exports(object, source);
    if on_exports {
        symbols.push(symbol(property, kind_of(right, source, locals), source));
    }
}

fn is_module_exports(node: Node<'_>, source: &[u8]) -> bool {
    node.kind() == "member_expression" && text(node, source) == "module.exports"
}

/// A property of `module.exports = { … }`.
fn exported_property(
    property: Node<'_>,
    source: &[u8],
    locals: &HashMap<String, Declared<'_>>,
    symbols: &mut Vec<Symbol>,
) {
    match property.kind() {
        "shorthand_property_identifier" => {
            let found = match locals.get(&text(property, source)) {
                Some(&(name, kind)) => symbol(name, kind, source),
                None => symbol(property, SymbolKind::Constant, source),
            };
            symbols.push(found);
        }
        "pair" => {
            let (Some(key), Some(value)) = (
                property.child_by_field_name("key"),
                property.child_by_field_name("value"),
            ) else {
                return;
            };
            if key.kind() == "property_identifier" {
                symbols.push(symbol(key, kind_of(value, source, locals), source));
            }
        }
        "method_definition" => {
            if let Some(name) = property.child_by_field_name("name") {
                symbols.push(symbol(name, SymbolKind::Function, source));
            }
        }
        _ => {}
    }
}

pub(super) fn default_export(root: Node<'_>, source: &[u8]) -> Option<DefaultExport> {
    let mut default: Option<Option<String>> = None;
    let mut by_name = HashSet::new();
    for node in children(root) {
        if node.kind() != "export_statement" || node.child_by_field_name("source").is_some() {
            continue;
        }
        let declaration = node.child_by_field_name("declaration");
        if has_token(node, "default") {
            // `export default function Button`, `export default Button`
            let name = declaration
                .or_else(|| node.child_by_field_name("value"))
                .and_then(|value| match value.kind() {
                    "identifier" => Some(value),
                    _ => value.child_by_field_name("name"),
                });
            default = Some(name.map(|name| text(name, source)));
            continue;
        }
        if let Some(declaration) = declaration {
            by_name.extend(
                declared(declaration)
                    .into_iter()
                    .map(|(name, _)| text(name, source)),
            );
            continue;
        }
        let clause = children(node)
            .into_iter()
            .find(|child| child.kind() == "export_clause");
        for specifier in clause.map(children).unwrap_or_default() {
            let Some(local) = specifier.child_by_field_name("name") else {
                continue;
            };
            let exported = specifier.child_by_field_name("alias").unwrap_or(local);
            if text(exported, source) == "default" {
                default = Some(Some(text(local, source)));
            } else {
                by_name.insert(text(exported, source));
            }
        }
    }
    default.map(|symbol| DefaultExport {
        symbol: symbol.filter(|name| !by_name.contains(name)),
    })
}

pub(super) fn statements(root: Node<'_>) -> (u32, u32) {
    let mut statements = 0;
    let mut reexports = 0;
    for node in children(root) {
        match node.kind() {
            "comment" | "hash_bang_line" | "import_statement" | "empty_statement" => {}
            // `"use strict"`
            "expression_statement"
                if children(node)
                    .first()
                    .is_some_and(|child| child.kind() == "string") => {}
            "export_statement" if node.child_by_field_name("source").is_some() => {
                statements += 1;
                reexports += 1;
            }
            _ => statements += 1,
        }
    }
    (statements, reexports)
}

/// Whether the node has a direct, unnamed child of this kind, such as the
/// `type` keyword of `import type`.
fn has_token(node: Node<'_>, kind: &str) -> bool {
    let mut cursor = node.walk();
    node.children(&mut cursor)
        .any(|child| !child.is_named() && child.kind() == kind)
}
