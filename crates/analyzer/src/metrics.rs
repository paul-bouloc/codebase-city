//! Metrics computed on a syntax tree.

use tree_sitter::{Node, Tree};

/// Cyclomatic complexity of a whole file: 1, plus 1 for every decision
/// point (branch, loop, case, catch, conditional expression, short-circuit
/// operator). Each language says which nodes are decisions.
pub(crate) fn complexity(tree: &Tree, is_decision: impl Fn(Node<'_>) -> bool) -> u32 {
    let mut complexity: u32 = 1;
    let mut cursor = tree.walk();
    // Depth-first, without recursion: deeply nested code cannot overflow the stack
    loop {
        if is_decision(cursor.node()) {
            complexity = complexity.saturating_add(1);
        }
        if cursor.goto_first_child() {
            continue;
        }
        while !cursor.goto_next_sibling() {
            if !cursor.goto_parent() {
                return complexity;
            }
        }
    }
}
