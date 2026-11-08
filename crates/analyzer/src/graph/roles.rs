//! Foundations and conductors (P9): the production units that the most code
//! depends on, and those that pull the most code together without much
//! depending on them. Barrels are facades and stay out of both.

use std::cmp::Reverse;

use model::Ranked;

use crate::graph::Node;
use crate::graph::reach::{Reach, Units};

/// Places in each ranking.
const RANKED: usize = 5;

/// How the graph was ranked, to check it by hand on real repositories. Not
/// part of the result.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RolesReport {
    /// Production files and Go packages.
    pub units: u32,
    /// Loops of imports, of two units or more.
    pub loops: u32,
    /// Units in the largest loop; 0 without any loop.
    pub largest_loop: u32,
    /// Whether the transitive counts were made: a repository too large or
    /// too tangled gets none, and no foundation or conductor.
    pub counted: bool,
}

/// What each unit is, by its row in the result.
pub(crate) struct Context<'a> {
    /// The folder of each file.
    pub file_dirs: &'a [u32],
    pub barrels: &'a [bool],
    /// Path of each file and of each folder (`""` for the root), to break
    /// ties the same way on every run.
    pub file_paths: &'a [&'a str],
    pub dir_paths: &'a [&'a str],
}

/// Foundations and conductors, and the report.
pub(crate) fn rank(
    units: &Units,
    reach: Option<&Reach>,
    context: &Context<'_>,
) -> (Ranked, Ranked, RolesReport) {
    let mut report = RolesReport {
        units: crate::saturating_u32(units.len()),
        ..RolesReport::default()
    };
    let Some(reach) = reach else {
        return (Ranked::default(), Ranked::default(), report);
    };
    report.counted = true;
    let mut sizes = vec![0u32; units.len()];
    for &component in &reach.components {
        sizes[component as usize] += 1;
    }
    report.loops = crate::saturating_u32(sizes.iter().filter(|&&size| size > 1).count());
    report.largest_loop = sizes
        .iter()
        .copied()
        .filter(|&size| size > 1)
        .max()
        .unwrap_or(0);

    let path = |unit: usize| match units.nodes[unit] {
        Node::File(file) => context.file_paths[file as usize],
        Node::Dir(dir) => context.dir_paths[dir as usize],
    };
    let dir_of = |unit: u32| match units.nodes[unit as usize] {
        Node::File(file) => context.file_dirs[file as usize],
        Node::Dir(dir) => dir,
    };
    let ranked: Vec<usize> = (0..units.len())
        .filter(|&unit| match units.nodes[unit] {
            Node::File(file) => !context.barrels[file as usize],
            Node::Dir(_) => true,
        })
        .collect();

    // Folders that import each unit directly: how widely it is used
    let mut importers: Vec<(u32, u32)> = Vec::new();
    for unit in 0..crate::saturating_u32(units.len()) {
        for &to in units.imports(unit) {
            importers.push((to, dir_of(unit)));
        }
    }
    importers.sort_unstable();
    importers.dedup();
    let mut spread = vec![0u32; units.len()];
    for (to, _) in importers {
        spread[to as usize] += 1;
    }

    let dependents = &reach.dependents;
    let dependencies = &reach.dependencies;
    // A conductor is little used by the code; a barrel re-exporting it
    // offers it, and does not count
    let users = &reach.users;
    let high = percentile(ranked.iter().map(|&unit| dependents[unit]), 4);
    let low = percentile(ranked.iter().map(|&unit| users[unit]), 1);

    let mut foundations: Vec<usize> = ranked
        .iter()
        .copied()
        .filter(|&unit| dependents[unit] > 0 && dependents[unit] >= high)
        .collect();
    foundations.sort_by_key(|&unit| (Reverse(dependents[unit]), Reverse(spread[unit]), path(unit)));
    let mut conductors: Vec<usize> = ranked
        .iter()
        .copied()
        .filter(|&unit| dependencies[unit] > 0 && users[unit] <= low)
        .collect();
    conductors.sort_by_key(|&unit| (Reverse(dependencies[unit]), path(unit)));

    let table = |order: Vec<usize>, counts: &[u32]| {
        let mut ranked = Ranked::default();
        for unit in order.into_iter().take(RANKED) {
            let (file, dir) = match units.nodes[unit] {
                Node::File(file) => (Some(file), None),
                Node::Dir(dir) => (None, Some(dir)),
            };
            ranked.file.push(file);
            ranked.dir.push(dir);
            ranked.count.push(counts[unit]);
        }
        ranked
    };
    (
        table(foundations, dependents),
        table(conductors, dependencies),
        report,
    )
}

/// The value below which `fifths` fifths of the values fall: 4 for the
/// 80th percentile, 1 for the 20th. 0 without values.
fn percentile(values: impl Iterator<Item = u32>, fifths: usize) -> u32 {
    let mut values: Vec<u32> = values.collect();
    values.sort_unstable();
    match values.len() {
        0 => 0,
        len => values[(len - 1) * fifths / 5],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentiles_split_by_fifths() {
        let values = || [5, 1, 4, 2, 3, 0, 9, 8, 7, 6].into_iter();
        assert_eq!(percentile(values(), 4), 7);
        assert_eq!(percentile(values(), 1), 1);
        assert_eq!(percentile(std::iter::empty(), 4), 0);
        assert_eq!(percentile(std::iter::once(3), 1), 3);
    }
}
