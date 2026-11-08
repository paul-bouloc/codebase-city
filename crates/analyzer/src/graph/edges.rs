//! The edges of the result, from the outcome of each import: one per
//! importing file and imported file or package folder, of the strongest
//! kind its imports have.

use std::collections::{BTreeMap, HashMap};

use model::{Confidence, EdgeKind};

use super::strength;
use crate::lang::Import;
use crate::resolve::{Outcome, Target};

/// An edge of the result: the importing file, whether the target is a
/// folder, and the target's row. Folder targets sort after file targets.
pub(crate) type Key = (u32, bool, u32);

/// How the imports of an analysis were resolved, to check the resolution
/// by hand on real repositories. Not part of the result.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ImportReport {
    /// Imports resolved by the language's own rules.
    pub exact: u32,
    /// Imports resolved only by the last-resort match on the path.
    pub likely: u32,
    pub external: u32,
    pub unresolved: u32,
    /// Imports of each kind, resolved or not.
    pub by_kind: Vec<(EdgeKind, u32)>,
    /// Modules that could not be resolved, with how many imports name
    /// them; the most frequent first.
    pub unresolved_modules: Vec<(String, u32)>,
    /// Packages counted as external only because nothing declares them,
    /// with how many imports name them; the most frequent first. An alias
    /// the resolver missed shows up here.
    pub undeclared_packages: Vec<(String, u32)>,
}

/// The edges of `imports`, each with its kind and confidence, and how the
/// imports were resolved. `outcomes` holds the outcome of each import, and
/// `dirs` the row of each folder by path.
pub(crate) fn edges(
    imports: &[Vec<Import>],
    outcomes: &[Vec<Outcome>],
    dirs: &HashMap<String, u32>,
) -> (BTreeMap<Key, (EdgeKind, Confidence)>, ImportReport) {
    let mut report = ImportReport::default();
    let mut by_kind: BTreeMap<u8, (EdgeKind, u32)> = BTreeMap::new();
    let mut unresolved: HashMap<&str, u32> = HashMap::new();
    let mut undeclared: HashMap<&str, u32> = HashMap::new();
    let mut edges: BTreeMap<Key, (EdgeKind, Confidence)> = BTreeMap::new();
    for (from, (imports, outcomes)) in imports.iter().zip(outcomes).enumerate() {
        let from = crate::saturating_u32(from);
        for (import, outcome) in imports.iter().zip(outcomes) {
            by_kind
                .entry(strength(import.kind))
                .or_insert((import.kind, 0))
                .1 += 1;
            let targets = match outcome {
                Outcome::Resolved(targets) => targets,
                Outcome::External => {
                    report.external += 1;
                    continue;
                }
                Outcome::Undeclared(package) => {
                    report.external += 1;
                    *undeclared.entry(package).or_default() += 1;
                    continue;
                }
                Outcome::Unresolved => {
                    report.unresolved += 1;
                    *unresolved.entry(&import.specifier).or_default() += 1;
                    continue;
                }
            };
            if targets
                .iter()
                .any(|(_, confidence)| *confidence == Confidence::Exact)
            {
                report.exact += 1;
            } else {
                report.likely += 1;
            }
            for (target, confidence) in targets {
                let key = match target {
                    Target::File(file) if *file == from => continue,
                    Target::File(file) => (from, false, *file),
                    // A package folder holds files, so the tree has it
                    Target::Dir(path) => match dirs.get(path.as_str()) {
                        Some(&dir) => (from, true, dir),
                        None => continue,
                    },
                };
                let edge = edges.entry(key).or_insert((import.kind, *confidence));
                if strength(import.kind) > strength(edge.0) {
                    edge.0 = import.kind;
                }
                if *confidence == Confidence::Exact {
                    edge.1 = Confidence::Exact;
                }
            }
        }
    }
    report.by_kind = by_kind.into_values().rev().collect();
    report.unresolved_modules = most_frequent(unresolved);
    report.undeclared_packages = most_frequent(undeclared);
    (edges, report)
}

/// Names with their count, the most frequent first, then by name.
fn most_frequent(counts: HashMap<&str, u32>) -> Vec<(String, u32)> {
    let mut sorted: Vec<(String, u32)> = counts
        .into_iter()
        .map(|(name, count)| (name.to_owned(), count))
        .collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    sorted
}
