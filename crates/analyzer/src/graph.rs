//! The import graph that rankings, layers and cycles are computed on.
//!
//! It differs from the edges of the result in two ways. An import of named
//! symbols through a barrel goes on to the files that declare them, so a
//! barrel does not stand in for the whole package it gathers. And the
//! production graph keeps only the code the project ships: no tests,
//! examples, docs, build output or generated files.

mod barrels;
pub(crate) mod cycles;
pub(crate) mod edges;
pub(crate) mod entries;
pub(crate) mod reach;
pub(crate) mod roles;

use std::collections::{BTreeMap, HashMap};

use model::{Confidence, EdgeKind, Scope, Symbols};

use crate::files::scope;
use crate::lang::{DefaultExport, Import};
use crate::resolve::{Outcome, Target};
use barrels::{Exports, Lookup, Lookups, targets_by_name, weakest};

/// Imports between the files of one analysis, barrels seen through.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Graph {
    /// Whether each file is part of the production code.
    production: Vec<bool>,
    barrel: Vec<bool>,
    /// Whether each folder of the result holds production code.
    dir_production: Vec<bool>,
    /// The edges of file `i` are `edges[offsets[i]..offsets[i + 1]]`.
    offsets: Vec<u32>,
    edges: Vec<Edge>,
}

/// An import of one file by another, after going through barrels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Edge {
    pub to: Node,
    /// The strongest kind among the imports that make the edge.
    pub kind: EdgeKind,
    pub confidence: Confidence,
    /// Every import that makes the edge goes through a barrel.
    pub via_barrel: bool,
}

/// What an edge points to, by its row in the result.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Node {
    File(u32),
    /// A package folder, for languages whose imports name one (Go).
    Dir(u32),
}

impl Graph {
    pub fn file_count(&self) -> usize {
        self.production.len()
    }

    /// Source code, not generated.
    pub fn is_production(&self, file: u32) -> bool {
        self.production[file as usize]
    }

    pub fn is_barrel(&self, file: u32) -> bool {
        self.barrel[file as usize]
    }

    /// The edges from a file, sorted by target, file targets first.
    pub fn edges(&self, file: u32) -> &[Edge] {
        let start = self.offsets[file as usize] as usize;
        let end = self.offsets[file as usize + 1] as usize;
        &self.edges[start..end]
    }

    /// The edges of the production graph from a file: none when the file is
    /// not production code, and only those to production code.
    pub fn production_edges(&self, file: u32) -> impl Iterator<Item = &Edge> {
        let edges = if self.is_production(file) {
            self.edges(file)
        } else {
            &[]
        };
        edges.iter().filter(|edge| match edge.to {
            Node::File(to) => self.production[to as usize],
            Node::Dir(to) => self.dir_production[to as usize],
        })
    }
}

/// How imports went through barrels, to check it by hand on real
/// repositories. Not part of the result.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BarrelReport {
    pub barrels: u32,
    /// Names imported from a barrel and followed to the file declaring them.
    pub names_through: u32,
    /// Names imported from a barrel that no re-export leads to.
    pub names_missing: u32,
    /// Names that two `export *` of a barrel both provide.
    pub names_ambiguous: u32,
    /// Imports of a barrel as a whole (`import * as ns`, `require`), which
    /// stay on the barrel.
    pub whole_imports: u32,
    /// Steps of lookup through re-exports, at most [`barrels::MAX_STEPS`].
    pub steps: u32,
}

/// What the graph is built from, row for row with the files of the result.
pub(crate) struct Input<'a> {
    /// Paths of the files.
    pub paths: &'a [&'a str],
    pub scopes: &'a [Scope],
    pub generated: &'a [bool],
    pub barrels: &'a [bool],
    pub defaults: &'a [Option<DefaultExport>],
    pub symbols: &'a Symbols,
    pub imports: &'a [Vec<Import>],
    pub outcomes: &'a [Vec<Outcome>],
    /// Folder rows by path, `""` for the root.
    pub dirs: &'a HashMap<String, u32>,
    /// Root folders of build tooling, from [`scope::tooling`].
    pub tooling: &'a [&'a str],
}

pub(crate) fn build(input: &Input<'_>) -> (Graph, BarrelReport) {
    let exports = Exports::new(input);
    let mut lookups = Lookups::new(&exports);
    let mut report = BarrelReport {
        barrels: crate::saturating_u32(input.barrels.iter().filter(|&&barrel| barrel).count()),
        ..BarrelReport::default()
    };
    let mut merged: BTreeMap<(u32, Node), (EdgeKind, Confidence, bool)> = BTreeMap::new();
    let mut add = |from: u32, to: Node, kind: EdgeKind, confidence: Confidence, via: bool| {
        if to == Node::File(from) {
            return;
        }
        let edge = merged.entry((from, to)).or_insert((kind, confidence, via));
        if strength(kind) > strength(edge.0) {
            edge.0 = kind;
        }
        if confidence == Confidence::Exact {
            edge.1 = Confidence::Exact;
        }
        edge.2 &= via;
    };

    for (from, (imports, outcomes)) in input.imports.iter().zip(input.outcomes).enumerate() {
        let from = crate::saturating_u32(from);
        for (import, outcome) in imports.iter().zip(outcomes) {
            let Outcome::Resolved(targets) = outcome else {
                continue;
            };
            let whole = import.names.is_empty() || import.names.iter().any(|name| name == "*");
            for (target, confidence) in targets {
                match target {
                    Target::Dir(path) => {
                        if let Some(&dir) = input.dirs.get(path) {
                            add(from, Node::Dir(dir), import.kind, *confidence, false);
                        }
                    }
                    Target::File(file) if !input.barrels[*file as usize] => {
                        add(from, Node::File(*file), import.kind, *confidence, false);
                    }
                    Target::File(file) if whole => {
                        report.whole_imports += 1;
                        add(from, Node::File(*file), import.kind, *confidence, false);
                    }
                    // Named imports from a barrel: each name below
                    Target::File(_) => {}
                }
            }
            if whole {
                continue;
            }
            let by_name = targets_by_name(input.paths, targets, &import.names);
            for (name, own) in import.names.iter().zip(&by_name) {
                for &(barrel, confidence) in own {
                    if !input.barrels[barrel as usize] {
                        continue;
                    }
                    let (to, confidence, via) = match lookups.find(barrel, name) {
                        Lookup::Found(file, found) if file != barrel => {
                            report.names_through += 1;
                            (file, weakest(confidence, found), true)
                        }
                        // The barrel declares the name itself
                        Lookup::Found(..) => (barrel, confidence, false),
                        Lookup::Missing => {
                            report.names_missing += 1;
                            (barrel, confidence, false)
                        }
                        Lookup::Ambiguous => {
                            report.names_ambiguous += 1;
                            (barrel, confidence, false)
                        }
                    };
                    add(from, Node::File(to), import.kind, confidence, via);
                }
            }
        }
    }

    let file_count = input.scopes.len();
    let mut offsets = Vec::with_capacity(file_count + 1);
    let mut edges = Vec::with_capacity(merged.len());
    let mut merged = merged.into_iter().peekable();
    for file in 0..file_count {
        offsets.push(crate::saturating_u32(edges.len()));
        report.steps = lookups.steps;
        let file = crate::saturating_u32(file);
        while let Some(((_, to), (kind, confidence, via_barrel))) =
            merged.next_if(|((from, _), _)| *from == file)
        {
            edges.push(Edge {
                to,
                kind,
                confidence,
                via_barrel,
            });
        }
    }
    offsets.push(crate::saturating_u32(edges.len()));
    report.steps = lookups.steps;

    let mut dir_production = vec![false; input.dirs.len()];
    for (path, &dir) in input.dirs {
        if let Some(production) = dir_production.get_mut(dir as usize) {
            *production = scope::of_dir(path).is_none() && !scope::is_tooling(path, input.tooling);
        }
    }
    let graph = Graph {
        production: input
            .scopes
            .iter()
            .zip(input.generated)
            .map(|(&scope, &generated)| scope == Scope::Source && !generated)
            .collect(),
        barrel: input.barrels.to_vec(),
        dir_production,
        offsets,
        edges,
    };
    (graph, report)
}

/// Which kind an edge keeps when a file imports the same target several
/// ways: the one that weighs most on the structure.
fn strength(kind: EdgeKind) -> u8 {
    match kind {
        EdgeKind::Reexport => 4,
        EdgeKind::Import => 3,
        EdgeKind::Lazy => 2,
        EdgeKind::Dynamic => 1,
        EdgeKind::Type => 0,
    }
}
