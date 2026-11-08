//! Parsing the analyzed languages with tree-sitter: complexity, exported
//! symbols, the header comment and the imports of each file, one module per
//! language.

mod go;
mod header;
mod javascript;
mod metrics;
mod python;

use std::collections::HashSet;

use model::{EdgeKind, SymbolKind};
use tree_sitter::{Node, Parser};

use crate::files::Language;

/// What parsing tells about one file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Parsed {
    /// Cyclomatic complexity of the whole file.
    pub complexity: u32,
    /// The leading comment or docstring, verbatim; see `header`.
    pub header: Option<String>,
    /// Exported symbols, in the order of the source.
    pub symbols: Vec<Symbol>,
    /// Imports with a literal module, in the order of the source.
    pub imports: Vec<Import>,
    /// A file made of re-exports, such as an `index.ts` or an `__init__.py`
    /// that gathers its package: see `is_barrel`.
    pub barrel: bool,
    /// The module's `export default`, if it has one.
    pub default_export: Option<DefaultExport>,
    /// The file starts a program: Go `func main` in `package main`, or a
    /// Python `if __name__ == "__main__":`.
    pub main: bool,
}

/// The default export of a module, which only an import of `default`
/// reaches: `export *` leaves it out.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DefaultExport {
    /// The symbol that is exported only as the default, listed under its
    /// own name among the symbols: `Button` for `export default function
    /// Button`. `None` when it has no name, or is also exported by name.
    pub symbol: Option<String>,
}

/// An import as the source writes it, before resolution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Import {
    /// The module, as written: `./store`, `..models` (a relative Python
    /// import keeps its dots), `github.com/gin-gonic/gin`.
    pub specifier: String,
    pub kind: EdgeKind,
    /// Line of the import, from 1.
    pub line: u32,
    /// The names it takes from the module, as the module exports them:
    /// `default` for a default import, `*` for all of them. Empty when it
    /// binds the module itself (`require`, `import a.b`, Go).
    pub names: Vec<String>,
    /// For a re-export, the name under which the file exports each of
    /// `names`, one to one (`Line` for `export { Rope as Line }`); empty
    /// when the import does not re-export.
    pub exports: Vec<String>,
}

/// A symbol a file exports.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Symbol {
    pub name: String,
    pub kind: SymbolKind,
    /// Line of the symbol's name, from 1.
    pub line: u32,
}

/// The grammar a file is parsed with: TypeScript and JavaScript each have
/// a variant with JSX.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Dialect {
    TypeScript,
    Tsx,
    JavaScript,
    Python,
    Go,
}

impl Dialect {
    fn of(path: &str, language: Language) -> Option<Self> {
        match language {
            Language::TypeScript if path.to_ascii_lowercase().ends_with(".tsx") => Some(Self::Tsx),
            Language::TypeScript => Some(Self::TypeScript),
            // The JavaScript grammar reads JSX as well
            Language::JavaScript => Some(Self::JavaScript),
            Language::Python => Some(Self::Python),
            Language::Go => Some(Self::Go),
            Language::Other(_) => None,
        }
    }

    fn grammar(self) -> tree_sitter::Language {
        match self {
            Self::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Self::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
            Self::JavaScript => tree_sitter_javascript::LANGUAGE.into(),
            Self::Python => tree_sitter_python::LANGUAGE.into(),
            Self::Go => tree_sitter_go::LANGUAGE.into(),
        }
    }

    fn is_decision(self, node: Node<'_>) -> bool {
        match self {
            Self::TypeScript | Self::Tsx | Self::JavaScript => javascript::is_decision(node),
            Self::Python => python::is_decision(node),
            Self::Go => go::is_decision(node),
        }
    }

    fn symbols(self, root: Node<'_>, source: &[u8]) -> Vec<Symbol> {
        match self {
            Self::TypeScript | Self::Tsx | Self::JavaScript => javascript::symbols(root, source),
            Self::Python => python::symbols(root, source),
            Self::Go => go::symbols(root, source),
        }
    }

    fn header(self, root: Node<'_>, source: &[u8]) -> Option<String> {
        match self {
            Self::TypeScript | Self::Tsx | Self::JavaScript => javascript::header(root, source),
            Self::Python => python::header(root, source),
            Self::Go => go::header(root, source),
        }
    }

    /// Top-level statements that count for [`is_barrel`], and how many of
    /// them re-export.
    fn statements(self, path: &str, root: Node<'_>, source: &[u8]) -> (u32, u32) {
        match self {
            Self::TypeScript | Self::Tsx | Self::JavaScript => javascript::statements(root),
            Self::Python => python::statements(path, root, source),
            Self::Go => (0, 0),
        }
    }

    fn default_export(self, root: Node<'_>, source: &[u8]) -> Option<DefaultExport> {
        match self {
            Self::TypeScript | Self::Tsx | Self::JavaScript => {
                javascript::default_export(root, source)
            }
            Self::Python | Self::Go => None,
        }
    }

    fn is_main(self, root: Node<'_>, source: &[u8]) -> bool {
        match self {
            Self::TypeScript | Self::Tsx | Self::JavaScript => false,
            Self::Python => python::is_main(root, source),
            Self::Go => go::is_main(root, source),
        }
    }

    fn imports(self, path: &str, root: Node<'_>, source: &[u8]) -> Vec<Import> {
        match self {
            Self::TypeScript | Self::Tsx | Self::JavaScript => javascript::imports(root, source),
            Self::Python => python::imports(path, root, source),
            Self::Go => go::imports(root, source),
        }
    }
}

/// Parses a file of an analyzed language; `None` for the other languages.
///
/// tree-sitter recovers from syntax errors, so a broken file is still
/// measured on the parts it could read.
pub fn parse(path: &str, language: Language, content: &[u8]) -> Option<Parsed> {
    let dialect = Dialect::of(path, language)?;
    let mut parser = Parser::new();
    // Fails only if the grammar was built for another tree-sitter ABI,
    // which the tests of every dialect would catch
    parser.set_language(&dialect.grammar()).ok()?;
    let tree = parser.parse(content, None)?;
    let root = tree.root_node();
    let mut symbols = dialect.symbols(root, content);
    // Syntax errors can leave a declaration without a name: tree-sitter
    // then fills in an empty, zero-width node
    symbols.retain(|symbol| !symbol.name.trim().is_empty());
    symbols.sort_by(|a, b| (a.line, &a.name).cmp(&(b.line, &b.name)));
    // TypeScript overloads declare a function once per signature, and
    // CommonJS can export the same function twice. A type and a value may
    // share a name (`interface User` and `const User`): both are kept
    let mut seen = HashSet::new();
    symbols.retain(|symbol| seen.insert((symbol.name.clone(), symbol.kind)));
    Some(Parsed {
        complexity: metrics::complexity(&tree, |node| dialect.is_decision(node)),
        header: dialect.header(root, content),
        symbols,
        imports: dialect.imports(path, root, content),
        barrel: is_barrel(dialect.statements(path, root, content)),
        default_export: dialect.default_export(root, content),
        main: dialect.is_main(root, content),
    })
}

/// Whether a file is a barrel: at least one re-export, and re-exports make
/// at least 80 % of the statements that count. Plain imports, comments and
/// directives do not count either way.
fn is_barrel((statements, reexports): (u32, u32)) -> bool {
    reexports > 0 && u64::from(reexports) * 5 >= u64::from(statements) * 4
}

/// The source text of a node; invalid UTF-8 is replaced, not rejected.
fn text(node: Node<'_>, source: &[u8]) -> String {
    String::from_utf8_lossy(&source[node.byte_range()]).into_owned()
}

/// The line of a node, from 1.
fn line(node: Node<'_>) -> u32 {
    crate::saturating_u32(node.start_position().row + 1)
}

/// A symbol named by `name`, at the line of that name.
fn symbol(name: Node<'_>, kind: SymbolKind, source: &[u8]) -> Symbol {
    Symbol {
        name: text(name, source),
        kind,
        line: line(name),
    }
}

/// Visits the nodes under `root`, depth-first and in source order, without
/// recursion. `visit` returns whether to go into the node's children.
fn walk<'tree>(root: Node<'tree>, mut visit: impl FnMut(Node<'tree>) -> bool) {
    let mut cursor = root.walk();
    loop {
        if visit(cursor.node()) && cursor.goto_first_child() {
            continue;
        }
        loop {
            if cursor.node() == root {
                return;
            }
            if cursor.goto_next_sibling() {
                break;
            }
            if !cursor.goto_parent() {
                return;
            }
        }
    }
}

/// Whether one of the node's ancestors is of one of these kinds.
fn has_ancestor(node: Node<'_>, kinds: &[&str]) -> bool {
    let mut current = node.parent();
    while let Some(ancestor) = current {
        if kinds.contains(&ancestor.kind()) {
            return true;
        }
        current = ancestor.parent();
    }
    false
}

/// The node's named children, in order.
fn children(node: Node<'_>) -> Vec<Node<'_>> {
    let mut cursor = node.walk();
    node.named_children(&mut cursor).collect()
}
