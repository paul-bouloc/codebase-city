//! The layers of the islands: an order in which most imports go down, as
//! Structure101 and Lattix find it.
//!
//! Between folders, nearly everything is in one loop (three.js: 47 folders
//! of 48), so sorting them by their imports gives a single layer. Instead,
//! each pair of islands keeps the direction most of its imports take; the
//! weighted Eades-Lin-Smyth heuristic orders what is left; imports set
//! aside are put back, the heaviest first, when they close no loop; and an
//! island's layer is the length of the longest path down to an island that
//! imports none, from 1.

use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet};

/// Steps allowed to put set-aside imports back. A few dozen islands take a
/// few thousand; past this, the rest stay aside, which can only leave some
/// layers lower than they could be.
const MAX_STEPS: u64 = 20_000_000;

/// The layer of each of `count` islands, from `imports`: `(importing
/// island, imported island)`, one per import. An island that imports no
/// other is in layer 1.
pub(crate) fn layers(count: usize, imports: impl Iterator<Item = (u32, u32)>) -> Vec<u32> {
    let mut weights: BTreeMap<(u32, u32), u64> = BTreeMap::new();
    for (from, to) in imports {
        if from != to {
            *weights.entry((from, to)).or_default() += 1;
        }
    }
    // Each pair keeps the direction most of its imports take; a tie keeps
    // neither for now
    let (majority, aside): (Vec<_>, Vec<_>) =
        weights.iter().partition(|&(&(from, to), &weight)| {
            weight > weights.get(&(to, from)).copied().unwrap_or(0)
        });
    let order = eades_lin_smyth(count, &majority);
    let mut position = vec![0usize; count];
    for (place, &island) in order.iter().enumerate() {
        position[island as usize] = place;
    }

    let mut kept = Adjacency::new(count);
    let mut rest: Vec<((u32, u32), u64)> = Vec::new();
    for &(&(from, to), &weight) in majority.iter().chain(&aside) {
        if position[from as usize] < position[to as usize] {
            kept.add(from, to);
        } else {
            rest.push(((from, to), weight));
        }
    }
    rest.sort_by_key(|&((from, to), weight)| (Reverse(weight), from, to));
    let mut steps = 0u64;
    for ((from, to), _) in rest {
        if steps >= MAX_STEPS {
            break;
        }
        if !kept.reaches(to, from, &mut steps) {
            kept.add(from, to);
        }
    }
    kept.longest_paths()
}

/// Islands ordered so that most of the weight goes forward: importers
/// first. `arcs` are `((from, to), weight)`, at most one per direction.
fn eades_lin_smyth(count: usize, arcs: &[(&(u32, u32), &u64)]) -> Vec<u32> {
    let mut out = vec![Vec::new(); count];
    let mut into = vec![Vec::new(); count];
    let mut out_weight = vec![0i64; count];
    let mut in_weight = vec![0i64; count];
    let mut out_degree = vec![0u32; count];
    let mut in_degree = vec![0u32; count];
    for &(&(from, to), &weight) in arcs {
        let weight = i64::try_from(weight).unwrap_or(i64::MAX);
        out[from as usize].push((to, weight));
        into[to as usize].push((from, weight));
        out_weight[from as usize] += weight;
        in_weight[to as usize] += weight;
        out_degree[from as usize] += 1;
        in_degree[to as usize] += 1;
    }

    // Each island waits in one of three sets, by what it is now
    let mut sinks = BTreeSet::new();
    let mut sources = BTreeSet::new();
    let mut others = BTreeSet::new();
    let delta = |island: usize, out_weight: &[i64], in_weight: &[i64]| {
        (Reverse(out_weight[island] - in_weight[island]), island)
    };
    for island in 0..count {
        if out_degree[island] == 0 {
            sinks.insert(island);
        } else if in_degree[island] == 0 {
            sources.insert(island);
        } else {
            others.insert(delta(island, &out_weight, &in_weight));
        }
    }

    let mut first = Vec::with_capacity(count);
    let mut last = Vec::new();
    let mut removed = vec![false; count];
    loop {
        let island = if let Some(island) = sinks.pop_first() {
            last.push(island);
            island
        } else if let Some(island) = sources.pop_first() {
            first.push(island);
            island
        } else if let Some((_, island)) = others.pop_first() {
            first.push(island);
            island
        } else {
            break;
        };
        removed[island] = true;
        let neighbours = out[island]
            .iter()
            .map(|&(to, weight)| (to as usize, weight, false))
            .chain(
                into[island]
                    .iter()
                    .map(|&(from, weight)| (from as usize, weight, true)),
            );
        for (neighbour, weight, importer) in neighbours {
            if removed[neighbour] {
                continue;
            }
            let was = (out_degree[neighbour], in_degree[neighbour]);
            others.remove(&delta(neighbour, &out_weight, &in_weight));
            if importer {
                out_weight[neighbour] -= weight;
                out_degree[neighbour] -= 1;
            } else {
                in_weight[neighbour] -= weight;
                in_degree[neighbour] -= 1;
            }
            if out_degree[neighbour] == 0 {
                sources.remove(&neighbour);
                sinks.insert(neighbour);
            } else if in_degree[neighbour] == 0 {
                if was.1 != 0 {
                    sources.insert(neighbour);
                }
            } else {
                others.insert(delta(neighbour, &out_weight, &in_weight));
            }
        }
    }
    last.reverse();
    first.extend(last);
    first.into_iter().map(crate::saturating_u32).collect()
}

/// Imports between islands that close no loop.
struct Adjacency {
    out: Vec<Vec<u32>>,
}

impl Adjacency {
    fn new(count: usize) -> Self {
        Self {
            out: vec![Vec::new(); count],
        }
    }

    fn add(&mut self, from: u32, to: u32) {
        self.out[from as usize].push(to);
    }

    /// Whether `to` can be reached from `from`, counting in `steps` each
    /// island looked at, and the islands of the set of those seen.
    fn reaches(&self, from: u32, to: u32, steps: &mut u64) -> bool {
        *steps += self.out.len() as u64;
        let mut seen = vec![false; self.out.len()];
        let mut todo = vec![from];
        seen[from as usize] = true;
        while let Some(island) = todo.pop() {
            *steps += 1;
            if island == to {
                return true;
            }
            for &next in &self.out[island as usize] {
                if !seen[next as usize] {
                    seen[next as usize] = true;
                    todo.push(next);
                }
            }
        }
        false
    }

    /// The layer of each island, 1 for an island that imports none. The
    /// imports close no loop, so every island gets one.
    fn longest_paths(&self) -> Vec<u32> {
        let count = self.out.len();
        let mut into = vec![Vec::new(); count];
        let mut waiting: Vec<usize> = self.out.iter().map(Vec::len).collect();
        for (from, out) in self.out.iter().enumerate() {
            for &to in out {
                into[to as usize].push(crate::saturating_u32(from));
            }
        }
        let mut layers = vec![1u32; count];
        let mut ready: Vec<usize> = (0..count).filter(|&island| waiting[island] == 0).collect();
        while let Some(island) = ready.pop() {
            for &from in &into[island] {
                let from = from as usize;
                layers[from] = layers[from].max(layers[island] + 1);
                waiting[from] -= 1;
                if waiting[from] == 0 {
                    ready.push(from);
                }
            }
        }
        layers
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Layers of `count` islands, from `(from, to, how many imports)`.
    fn layered(count: usize, imports: &[(u32, u32, usize)]) -> Vec<u32> {
        layers(
            count,
            imports
                .iter()
                .flat_map(|&(from, to, times)| std::iter::repeat_n((from, to), times)),
        )
    }

    #[test]
    fn a_chain_climbs_one_layer_per_island() {
        // 2 → 1 → 0, and 3 alone
        assert_eq!(layered(4, &[(2, 1, 1), (1, 0, 1)]), [1, 2, 3, 1]);
    }

    #[test]
    fn the_layer_is_the_longest_way_down() {
        // 3 → 0 directly and 3 → 2 → 1 → 0
        assert_eq!(
            layered(4, &[(3, 0, 5), (3, 2, 1), (2, 1, 1), (1, 0, 1)]),
            [1, 2, 3, 4]
        );
    }

    #[test]
    fn most_imports_of_a_pair_decide_its_direction() {
        // 1 imports 0 ten times, 0 imports 1 twice
        assert_eq!(layered(2, &[(0, 1, 2), (1, 0, 10)]), [1, 2]);
        assert_eq!(layered(2, &[(0, 1, 10), (1, 0, 2)]), [2, 1]);
    }

    #[test]
    fn a_loop_of_three_islands_drops_its_lightest_import() {
        // 2 → 1 → 0 heavily, and 0 → 2 once
        assert_eq!(layered(3, &[(2, 1, 9), (1, 0, 9), (0, 2, 1)]), [1, 2, 3]);
    }

    #[test]
    fn a_tie_keeps_one_direction() {
        assert_eq!(layered(2, &[(0, 1, 3), (1, 0, 3)]), [1, 2]);
    }

    #[test]
    fn an_import_set_aside_comes_back_when_it_closes_no_loop() {
        // Two loops, 0 → 1 → 2 → 0 and 3 → 4 → 5 → 3, and 3 → 1. The
        // heuristic places 1 before 3, which sets 3 → 1 aside; it closes no
        // loop, so it comes back and lifts 3 above 1
        let layers = layered(
            6,
            &[
                (0, 1, 1),
                (1, 2, 5),
                (2, 0, 5),
                (3, 4, 1),
                (4, 5, 1),
                (5, 3, 1),
                (3, 1, 1),
            ],
        );
        assert_eq!(layers, [1, 3, 2, 4, 2, 1]);
    }

    #[test]
    fn islands_without_imports_are_all_in_the_first_layer() {
        assert_eq!(layered(3, &[]), [1, 1, 1]);
        assert_eq!(layered(0, &[]), Vec::<u32>::new());
    }

    #[test]
    fn the_same_imports_in_another_order_give_the_same_layers() {
        let imports = [
            (5, 4, 3),
            (4, 3, 2),
            (3, 4, 1),
            (2, 1, 1),
            (1, 2, 1),
            (0, 5, 2),
        ];
        let mut reversed = imports;
        reversed.reverse();
        assert_eq!(layered(6, &imports), layered(6, &reversed));
    }
}
