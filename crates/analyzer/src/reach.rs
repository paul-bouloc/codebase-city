//! How many production files depend on each one, directly or not, and how
//! many it depends on (P9): the measures that foundations and conductors are
//! ranked by.
//!
//! The count runs on units: a production file, or a whole Go package, whose
//! files import each other freely and are imported as one folder. Files that
//! import each other in a loop can all reach each other, so the loops are
//! collapsed first and the count runs on what is left, which has none.

use crate::graph::{Graph, Node};

/// Work allowed for the count, in steps of the inner loops. vscode takes
/// about 30 million; past this, a repository too large or too tangled gets
/// no count rather than holding the analysis.
const MAX_WORK: u64 = 3_000_000_000;

/// The production code as units, with the imports between them.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Units {
    /// What each unit is: a file, or a Go package folder.
    pub nodes: Vec<Node>,
    /// Files in each unit.
    pub weights: Vec<u32>,
    /// The unit of each file of the result; `None` outside production.
    pub of_file: Vec<Option<u32>>,
    /// The units that unit `i` imports are
    /// `targets[offsets[i]..offsets[i + 1]]`, sorted and unique.
    offsets: Vec<u32>,
    targets: Vec<u32>,
}

impl Units {
    /// `dirs[i]` is the folder of file `i`; `packages[i]` says whether its
    /// language imports folders rather than files (Go).
    pub(crate) fn new(graph: &Graph, dirs: &[u32], packages: &[bool]) -> Self {
        let mut units = Self::default();
        let mut of_dir: std::collections::HashMap<u32, u32> = std::collections::HashMap::new();
        for file in 0..graph.file_count() {
            let row = crate::saturating_u32(file);
            if !graph.is_production(row) {
                units.of_file.push(None);
                continue;
            }
            let unit = if packages[file] {
                *of_dir.entry(dirs[file]).or_insert_with(|| {
                    units.nodes.push(Node::Dir(dirs[file]));
                    units.weights.push(0);
                    crate::saturating_u32(units.nodes.len() - 1)
                })
            } else {
                units.nodes.push(Node::File(row));
                units.weights.push(0);
                crate::saturating_u32(units.nodes.len() - 1)
            };
            units.weights[unit as usize] += 1;
            units.of_file.push(Some(unit));
        }

        let mut edges: Vec<(u32, u32)> = Vec::new();
        for file in 0..graph.file_count() {
            let Some(from) = units.of_file[file] else {
                continue;
            };
            for edge in graph.production_edges(crate::saturating_u32(file)) {
                let to = match edge.to {
                    Node::File(to) => units.of_file[to as usize],
                    // A folder with no production Go file is no unit
                    Node::Dir(to) => of_dir.get(&to).copied(),
                };
                if let Some(to) = to.filter(|&to| to != from) {
                    edges.push((from, to));
                }
            }
        }
        units.set_edges(edges);
        units
    }

    /// Units of the given weights and imports, for the tests.
    #[cfg(test)]
    pub(crate) fn from_edges(weights: Vec<u32>, edges: Vec<(u32, u32)>) -> Self {
        let mut units = Self {
            nodes: (0..crate::saturating_u32(weights.len()))
                .map(Node::File)
                .collect(),
            of_file: (0..crate::saturating_u32(weights.len()))
                .map(Some)
                .collect(),
            weights,
            ..Self::default()
        };
        units.set_edges(edges);
        units
    }

    fn set_edges(&mut self, mut edges: Vec<(u32, u32)>) {
        edges.sort_unstable();
        edges.dedup();
        let (offsets, targets) = csr(self.nodes.len(), &edges);
        self.offsets = offsets;
        self.targets = targets;
    }

    pub(crate) fn len(&self) -> usize {
        self.nodes.len()
    }

    /// The units that `unit` imports, sorted.
    pub(crate) fn imports(&self, unit: u32) -> &[u32] {
        let start = self.offsets[unit as usize] as usize;
        let end = self.offsets[unit as usize + 1] as usize;
        &self.targets[start..end]
    }
}

/// Transitive counts, in files, unit by unit. A unit's own files are not
/// counted; the other members of its loop, if any, are.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Reach {
    /// Production files that depend on the unit, directly or not.
    pub dependents: Vec<u32>,
    /// Production files the unit depends on, directly or not.
    pub dependencies: Vec<u32>,
    /// The loop each unit is part of, numbered so that a loop only reaches
    /// loops of lower numbers; a unit outside any loop is a loop of one.
    pub components: Vec<u32>,
}

/// Counts dependents and dependencies; `None` when that would take more
/// than [`MAX_WORK`].
pub(crate) fn reach(units: &Units) -> Option<Reach> {
    let components = strong_components(units);
    let count = components.iter().max().map_or(0, |&last| last as usize + 1);
    let mut weights = vec![0u64; count];
    let mut edges: Vec<(u32, u32)> = Vec::new();
    for unit in 0..units.len() {
        let from = components[unit];
        weights[from as usize] += u64::from(units.weights[unit]);
        for &to in units.imports(crate::saturating_u32(unit)) {
            let to = components[to as usize];
            if to != from {
                edges.push((from, to));
            }
        }
    }
    edges.sort_unstable();
    edges.dedup();
    let blocks = count.div_ceil(64) as u64;
    let work = blocks * (count as u64 * 8 + edges.len() as u64) * 2;
    if work > MAX_WORK {
        return None;
    }
    let (offsets, targets) = csr(count, &edges);
    let succ =
        |component: usize| &targets[offsets[component] as usize..offsets[component + 1] as usize];

    // Bit `j` of `bits[c]` says whether component `c` reaches (or is
    // reached from) component `64 * block + j`. Components only reach
    // lower numbers, so each pass skips the components that cannot matter
    let mut reached = vec![0u64; count];
    let mut reaching = vec![0u64; count];
    let mut bits = vec![0u64; count];
    for block in 0..count.div_ceil(64) {
        let first = block * 64;
        let last = (first + 64).min(count);
        let sums = ByteSums::new(&weights[first..last]);

        bits.fill(0);
        for component in first..count {
            let mut own = if component < last {
                1u64 << (component - first)
            } else {
                0
            };
            for &to in succ(component) {
                own |= bits[to as usize];
            }
            bits[component] = own;
            reached[component] += sums.of(own);
        }

        bits.fill(0);
        for component in (0..last).rev() {
            if component >= first {
                bits[component] |= 1u64 << (component - first);
            }
            let own = bits[component];
            reaching[component] += sums.of(own);
            if own != 0 {
                for &to in succ(component) {
                    bits[to as usize] |= own;
                }
            }
        }
    }

    let count_for = |totals: &[u64]| -> Vec<u32> {
        (0..units.len())
            .map(|unit| {
                let total = totals[components[unit] as usize] - u64::from(units.weights[unit]);
                u32::try_from(total).unwrap_or(u32::MAX)
            })
            .collect()
    };
    Some(Reach {
        dependents: count_for(&reaching),
        dependencies: count_for(&reached),
        components,
    })
}

/// Sums of the weights of the set bits of a 64-bit word, a byte at a time.
struct ByteSums {
    tables: Vec<[u64; 256]>,
}

impl ByteSums {
    fn new(weights: &[u64]) -> Self {
        let tables = (0..8)
            .map(|byte| {
                let mut table = [0u64; 256];
                for pattern in 1..256usize {
                    let low = pattern.trailing_zeros() as usize;
                    let weight = weights.get(byte * 8 + low).copied().unwrap_or(0);
                    table[pattern] = table[pattern & (pattern - 1)] + weight;
                }
                table
            })
            .collect();
        Self { tables }
    }

    fn of(&self, word: u64) -> u64 {
        if word == 0 {
            return 0;
        }
        self.tables
            .iter()
            .zip(word.to_le_bytes())
            .map(|(table, byte)| table[byte as usize])
            .sum()
    }
}

/// Strongly connected components by Tarjan's algorithm, without recursion.
/// A component is numbered once every component it reaches has been, so
/// imports only go to lower numbers.
fn strong_components(units: &Units) -> Vec<u32> {
    let mut tarjan = Tarjan::new(units.len());
    for root in 0..crate::saturating_u32(units.len()) {
        if tarjan.order[root as usize] != UNSEEN {
            continue;
        }
        tarjan.open(root);
        while let Some(&(unit, visited)) = tarjan.frames.last() {
            if let Some(&to) = units.imports(unit).get(visited) {
                if let Some(frame) = tarjan.frames.last_mut() {
                    frame.1 += 1;
                }
                if tarjan.order[to as usize] == UNSEEN {
                    tarjan.open(to);
                } else if tarjan.on_stack[to as usize] {
                    let low = tarjan.low[unit as usize].min(tarjan.order[to as usize]);
                    tarjan.low[unit as usize] = low;
                }
            } else {
                tarjan.close(unit);
            }
        }
    }
    tarjan.components
}

const UNSEEN: u32 = u32::MAX;

/// The state of [`strong_components`].
struct Tarjan {
    /// When each unit was first visited.
    order: Vec<u32>,
    /// The earliest unit on the stack each unit reaches.
    low: Vec<u32>,
    on_stack: Vec<bool>,
    stack: Vec<u32>,
    /// The walk in progress: a unit and how many of its imports it visited.
    frames: Vec<(u32, usize)>,
    components: Vec<u32>,
    next: u32,
    numbered: u32,
}

impl Tarjan {
    fn new(count: usize) -> Self {
        Self {
            order: vec![UNSEEN; count],
            low: vec![0; count],
            on_stack: vec![false; count],
            stack: Vec::new(),
            frames: Vec::new(),
            components: vec![UNSEEN; count],
            next: 0,
            numbered: 0,
        }
    }

    fn open(&mut self, unit: u32) {
        self.order[unit as usize] = self.next;
        self.low[unit as usize] = self.next;
        self.next += 1;
        self.stack.push(unit);
        self.on_stack[unit as usize] = true;
        self.frames.push((unit, 0));
    }

    /// Done with the imports of `unit`: numbers its component if it is the
    /// first unit of it.
    fn close(&mut self, unit: u32) {
        self.frames.pop();
        if let Some(&(parent, _)) = self.frames.last() {
            self.low[parent as usize] = self.low[parent as usize].min(self.low[unit as usize]);
        }
        if self.low[unit as usize] == self.order[unit as usize] {
            while let Some(member) = self.stack.pop() {
                self.on_stack[member as usize] = false;
                self.components[member as usize] = self.numbered;
                if member == unit {
                    break;
                }
            }
            self.numbered += 1;
        }
    }
}

/// Offsets and targets of sorted `(from, to)` pairs over `count` nodes.
fn csr(count: usize, edges: &[(u32, u32)]) -> (Vec<u32>, Vec<u32>) {
    let mut offsets = Vec::with_capacity(count + 1);
    let mut position = 0;
    for node in 0..count {
        offsets.push(crate::saturating_u32(position));
        while edges
            .get(position)
            .is_some_and(|&(from, _)| from as usize == node)
        {
            position += 1;
        }
    }
    offsets.push(crate::saturating_u32(position));
    let targets = edges.iter().map(|&(_, to)| to).collect();
    (offsets, targets)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn counts(weights: Vec<u32>, edges: Vec<(u32, u32)>) -> (Vec<u32>, Vec<u32>) {
        let reach = reach(&Units::from_edges(weights, edges)).unwrap();
        (reach.dependents, reach.dependencies)
    }

    #[test]
    fn a_chain_counts_everything_upstream_and_downstream() {
        // 0 → 1 → 2
        let (dependents, dependencies) = counts(vec![1; 3], vec![(0, 1), (1, 2)]);
        assert_eq!(dependents, [0, 1, 2]);
        assert_eq!(dependencies, [2, 1, 0]);
    }

    #[test]
    fn a_diamond_counts_each_file_once() {
        // 0 → 1 → 3, 0 → 2 → 3
        let (dependents, dependencies) = counts(vec![1; 4], vec![(0, 1), (0, 2), (1, 3), (2, 3)]);
        assert_eq!(dependents, [0, 1, 1, 3]);
        assert_eq!(dependencies, [3, 1, 1, 0]);
    }

    #[test]
    fn members_of_a_loop_count_each_other() {
        // 0 → 1 ⇄ 2 → 3
        let (dependents, dependencies) = counts(vec![1; 4], vec![(0, 1), (1, 2), (2, 1), (2, 3)]);
        assert_eq!(dependents, [0, 2, 2, 3]);
        assert_eq!(dependencies, [3, 2, 2, 0]);
    }

    #[test]
    fn a_package_counts_its_files_but_not_its_own() {
        // 0 → package 1 (three files) → 2
        let (dependents, dependencies) = counts(vec![1, 3, 1], vec![(0, 1), (1, 2)]);
        assert_eq!(dependents, [0, 1, 4]);
        assert_eq!(dependencies, [4, 1, 0]);
    }

    #[test]
    fn nothing_to_count() {
        assert_eq!(counts(Vec::new(), Vec::new()), (Vec::new(), Vec::new()));
        assert_eq!(counts(vec![1], Vec::new()), (vec![0], vec![0]));
    }

    #[test]
    fn loops_reach_only_lower_numbers() {
        let units = Units::from_edges(vec![1; 5], vec![(0, 1), (1, 0), (1, 2), (3, 4), (4, 2)]);
        let components = strong_components(&units);
        assert_eq!(components[0], components[1]);
        for (from, to) in [(1, 2), (3, 4), (4, 2)] {
            assert!(components[from] > components[to]);
        }
    }

    /// A small xorshift generator: the same graphs on every run.
    struct Random(u64);

    impl Random {
        fn below(&mut self, bound: u32) -> u32 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            (self.0 % u64::from(bound)) as u32
        }
    }

    /// Files reached from `start` by a plain walk, `start` left out.
    fn walk(count: usize, edges: &[(u32, u32)], start: u32, weights: &[u32]) -> u32 {
        let mut seen = vec![false; count];
        let mut todo = vec![start];
        seen[start as usize] = true;
        while let Some(node) = todo.pop() {
            for &(from, to) in edges {
                if from == node && !seen[to as usize] {
                    seen[to as usize] = true;
                    todo.push(to);
                }
            }
        }
        (0..count)
            .filter(|&node| seen[node] && node != start as usize)
            .map(|node| weights[node])
            .sum()
    }

    #[test]
    fn counts_match_a_plain_walk_on_random_graphs() {
        let mut random = Random(0x5eed);
        // Over 64 units, so the counts run in several blocks
        for (count, edge_count) in [(10, 15), (70, 90), (150, 140), (200, 600)] {
            let weights: Vec<u32> = (0..count).map(|_| 1 + random.below(3)).collect();
            let edges: Vec<(u32, u32)> = (0..edge_count)
                .map(|_| (random.below(count), random.below(count)))
                .filter(|(from, to)| from != to)
                .collect();
            let reversed: Vec<(u32, u32)> = edges.iter().map(|&(from, to)| (to, from)).collect();
            let (dependents, dependencies) = counts(weights.clone(), edges.clone());
            for unit in 0..count {
                let size = count as usize;
                assert_eq!(
                    dependencies[unit as usize],
                    walk(size, &edges, unit, &weights)
                );
                assert_eq!(
                    dependents[unit as usize],
                    walk(size, &reversed, unit, &weights)
                );
            }
        }
    }
}
