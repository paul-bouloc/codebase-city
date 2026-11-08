//! Production files that import each other in a loop, and one of the
//! shortest loops that shows it.
//!
//! Only plain imports and re-exports count (P10): a lazy import is often
//! there to break a loop at runtime, and a type import is erased. Barrels
//! are seen through and left out, or every package that gathers its files
//! in an `index.ts` would loop through it.

use std::cmp::Reverse;
use std::collections::VecDeque;

use model::{Cycles, EdgeKind};

use crate::graph::reach::{csr, strong_components};
use crate::graph::{Graph, Node};

/// The loops of the production graph, the largest first, then by first
/// file.
pub(crate) fn cycles(graph: &Graph) -> Cycles {
    let count = graph.file_count();
    let counted = |file: u32| graph.is_production(file) && !graph.is_barrel(file);
    let mut edges: Vec<(u32, u32)> = Vec::new();
    for from in (0..crate::saturating_u32(count)).filter(|&file| counted(file)) {
        for edge in graph.production_edges(from) {
            if let Node::File(to) = edge.to
                && matches!(edge.kind, EdgeKind::Import | EdgeKind::Reexport)
                && counted(to)
            {
                edges.push((from, to));
            }
        }
    }
    edges.sort_unstable();
    edges.dedup();
    let (offsets, targets) = csr(count, &edges);
    let imports =
        |file: u32| &targets[offsets[file as usize] as usize..offsets[file as usize + 1] as usize];
    let components = strong_components(count, imports);

    let mut members: Vec<Vec<u32>> = vec![Vec::new(); count];
    for (file, &component) in components.iter().enumerate() {
        members[component as usize].push(crate::saturating_u32(file));
    }
    let mut loops: Vec<Vec<u32>> = members
        .into_iter()
        .filter(|files| files.len() > 1)
        .collect();
    loops.sort_by_key(|files| (Reverse(files.len()), files[0]));

    let mut cycles = Cycles::default();
    for files in loops {
        let component = components[files[0] as usize];
        let inside = |file: u32| components[file as usize] == component;
        cycles.shortest.push(shortest(&files, imports, inside));
        cycles.members.push(files);
    }
    cycles
}

/// A shortest loop through the busiest file of a loop: the one with the
/// most imports in times out within it, the first on a tie.
fn shortest<'a>(
    files: &[u32],
    imports: impl Fn(u32) -> &'a [u32],
    inside: impl Fn(u32) -> bool,
) -> Vec<u32> {
    let mut incoming = vec![0u64; files.len()];
    let mut outgoing = vec![0u64; files.len()];
    let place = |file: u32| files.binary_search(&file).ok();
    for (row, &file) in files.iter().enumerate() {
        for &to in imports(file).iter().filter(|&&to| inside(to)) {
            outgoing[row] += 1;
            if let Some(target) = place(to) {
                incoming[target] += 1;
            }
        }
    }
    let start = (0..files.len())
        .max_by_key(|&row| (incoming[row] * outgoing[row], Reverse(row)))
        .map_or(files[0], |row| files[row]);

    // Breadth first from the start, until an import leads back to it
    let mut previous: Vec<Option<u32>> = vec![None; files.len()];
    let mut todo = VecDeque::from([start]);
    while let Some(file) = todo.pop_front() {
        for &to in imports(file).iter().filter(|&&to| inside(to)) {
            if to == start {
                let mut path = vec![file];
                let mut current = file;
                while let Some(before) = place(current).and_then(|row| previous[row]) {
                    path.push(before);
                    current = before;
                }
                path.reverse();
                return path;
            }
            if let Some(row) = place(to)
                && previous[row].is_none()
            {
                previous[row] = Some(file);
                todo.push_back(to);
            }
        }
    }
    // Unreachable for a loop: every file reaches every other one
    files.to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The shortest loop of a loop given as sorted files and imports.
    fn shortest_of(files: &[u32], edges: &[(u32, u32)]) -> Vec<u32> {
        let mut edges = edges.to_vec();
        edges.sort_unstable();
        let count = files.iter().max().map_or(0, |&last| last as usize + 1);
        let (offsets, targets) = csr(count, &edges);
        let imports = |file: u32| {
            &targets[offsets[file as usize] as usize..offsets[file as usize + 1] as usize]
        };
        shortest(files, imports, |file| files.contains(&file))
    }

    #[test]
    fn a_pair_loops_from_the_first_file() {
        assert_eq!(shortest_of(&[3, 7], &[(3, 7), (7, 3)]), [3, 7]);
    }

    #[test]
    fn the_shortest_loop_takes_the_shortcut() {
        // 0 → 1 → 2 → 3 → 0, and 2 → 0: 0 and 2 are the busiest, 0 comes
        // first, and 2 leads straight back to it
        let edges = [(0, 1), (1, 2), (2, 3), (3, 0), (2, 0)];
        let path = shortest_of(&[0, 1, 2, 3], &edges);
        assert_eq!(path, [0, 1, 2]);
    }

    #[test]
    fn the_start_is_the_busiest_file() {
        // 2 is in two loops: 2 ⇄ 0 and 2 ⇄ 1
        let edges = [(0, 2), (2, 0), (1, 2), (2, 1)];
        assert_eq!(shortest_of(&[0, 1, 2], &edges), [2, 0]);
    }
}
