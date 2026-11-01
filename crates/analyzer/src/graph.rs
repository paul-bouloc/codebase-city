//! The import graph that rankings, layers and cycles are computed on.
//!
//! It differs from the edges of the result in two ways. An import of named
//! symbols through a barrel goes on to the files that declare them, so a
//! barrel does not stand in for the whole package it gathers. And the
//! production graph keeps only the code the project ships: no tests,
//! examples, docs, build output or generated files.

use std::collections::{BTreeMap, HashMap, HashSet};

use model::{Confidence, EdgeKind, Scope, Symbols};

use crate::lang::Import;
use crate::resolve::{Outcome, Target};
use crate::scope;

/// Re-export chains longer than this are not followed, which bounds the
/// recursion.
const MAX_DEPTH: usize = 256;

/// Steps of lookup through re-exports, over the whole analysis. Past it,
/// imports stay on their barrel: a repository built to make lookups slow
/// cannot hold the analysis. nest takes about 25 000, vscode 16 000.
const MAX_STEPS: u32 = 2_000_000;

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
    /// Steps of lookup through re-exports, at most [`MAX_STEPS`].
    pub steps: u32,
}

/// What the graph is built from, row for row with the files of the result.
pub(crate) struct Input<'a> {
    pub scopes: &'a [Scope],
    pub generated: &'a [bool],
    pub barrels: &'a [bool],
    pub symbols: &'a Symbols,
    pub imports: &'a [Vec<Import>],
    pub outcomes: &'a [Vec<Outcome>],
    /// Folder rows by path, `""` for the root.
    pub dirs: &'a HashMap<String, u32>,
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
            for (target, confidence) in targets {
                let target = match target {
                    Target::File(file) => *file,
                    Target::Dir(path) => {
                        if let Some(&dir) = input.dirs.get(path) {
                            add(from, Node::Dir(dir), import.kind, *confidence, false);
                        }
                        continue;
                    }
                };
                if !input.barrels[target as usize] {
                    add(from, Node::File(target), import.kind, *confidence, false);
                    continue;
                }
                if import.names.is_empty() || import.names.iter().any(|name| name == "*") {
                    report.whole_imports += 1;
                    add(from, Node::File(target), import.kind, *confidence, false);
                    continue;
                }
                for name in &import.names {
                    match lookups.find(target, name) {
                        Lookup::Found(file, found) if file != target => {
                            report.names_through += 1;
                            let confidence = weakest(*confidence, found);
                            add(from, Node::File(file), import.kind, confidence, true);
                        }
                        // The barrel declares the name itself
                        Lookup::Found(..) => {
                            add(from, Node::File(target), import.kind, *confidence, false);
                        }
                        Lookup::Missing => {
                            report.names_missing += 1;
                            add(from, Node::File(target), import.kind, *confidence, false);
                        }
                        Lookup::Ambiguous => {
                            report.names_ambiguous += 1;
                            add(from, Node::File(target), import.kind, *confidence, false);
                        }
                    }
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
            *production = scope::of_dir(path).is_none();
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

/// Where a name a file exports is declared.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Lookup {
    /// The file declaring it, and how sure the chain of re-exports is.
    Found(u32, Confidence),
    Missing,
    /// Two `export *` provide it, from different files.
    Ambiguous,
}

/// A name re-exported from another module: its name there, and one of the
/// files that module resolved to.
type Source<'a> = (&'a str, u32, Confidence);

/// What each file declares and re-exports.
struct Exports<'a> {
    declared: HashSet<(u32, &'a str)>,
    /// By file and exported name: the name in the module it comes from,
    /// and the files that module resolved to.
    named: HashMap<(u32, &'a str), Vec<Source<'a>>>,
    /// By file: the files whose exports it re-exports whole.
    stars: HashMap<u32, Vec<(u32, Confidence)>>,
    /// Files with a re-export of either kind.
    reexporting: HashSet<u32>,
}

impl<'a> Exports<'a> {
    fn new(input: &Input<'a>) -> Self {
        let declared = input
            .symbols
            .file
            .iter()
            .zip(&input.symbols.name)
            .map(|(&file, name)| (file, name.as_str()))
            .collect();
        let mut named: HashMap<_, Vec<_>> = HashMap::new();
        let mut stars: HashMap<_, Vec<_>> = HashMap::new();
        let mut reexporting = HashSet::new();
        for (file, (imports, outcomes)) in input.imports.iter().zip(input.outcomes).enumerate() {
            let file = crate::saturating_u32(file);
            for (import, outcome) in imports.iter().zip(outcomes) {
                let Outcome::Resolved(targets) = outcome else {
                    continue;
                };
                let targets = targets
                    .iter()
                    .filter_map(|(target, confidence)| match target {
                        Target::File(target) => Some((*target, *confidence)),
                        Target::Dir(_) => None,
                    });
                for (target, confidence) in targets {
                    for (name, export) in import.names.iter().zip(&import.exports) {
                        reexporting.insert(file);
                        if export == "*" {
                            stars.entry(file).or_default().push((target, confidence));
                        } else {
                            named.entry((file, export.as_str())).or_default().push((
                                name.as_str(),
                                target,
                                confidence,
                            ));
                        }
                    }
                }
            }
        }
        Self {
            declared,
            named,
            stars,
            reexporting,
        }
    }
}

/// Lookups of names through re-exports, and what they found so far.
struct Lookups<'e, 'a> {
    exports: &'e Exports<'a>,
    /// Every lookup is made once: chains of `export *` that meet again
    /// would otherwise be walked once per path, exponentially many.
    memo: HashMap<(u32, &'a str), Lookup>,
    /// The chain followed so far, to stop on a loop.
    visiting: Vec<(u32, &'a str)>,
    steps: u32,
}

impl<'e, 'a> Lookups<'e, 'a> {
    fn new(exports: &'e Exports<'a>) -> Self {
        Self {
            exports,
            memo: HashMap::new(),
            visiting: Vec::new(),
            steps: 0,
        }
    }

    /// The file that declares `name`, as `file` exports it.
    ///
    /// A lookup cut short by a loop or by the depth limit is remembered as
    /// missing, even for files of the chain that would find the name from
    /// elsewhere. Both only happen in broken or contrived repositories.
    fn find(&mut self, file: u32, name: &'a str) -> Lookup {
        let exports = self.exports;
        if exports.declared.contains(&(file, name)) {
            return Lookup::Found(file, Confidence::Exact);
        }
        if self.steps >= MAX_STEPS {
            return Lookup::Missing;
        }
        self.steps += 1;
        if !exports.reexporting.contains(&file) {
            return Lookup::Missing;
        }
        if let Some(&lookup) = self.memo.get(&(file, name)) {
            return lookup;
        }
        if self.visiting.len() >= MAX_DEPTH || self.visiting.contains(&(file, name)) {
            return Lookup::Missing;
        }
        self.visiting.push((file, name));
        let lookup = self.find_reexported(file, name);
        self.visiting.pop();
        self.memo.insert((file, name), lookup);
        lookup
    }

    fn find_reexported(&mut self, file: u32, name: &'a str) -> Lookup {
        let exports = self.exports;
        if let Some(sources) = exports.named.get(&(file, name)) {
            for &(source, target, confidence) in sources {
                // `export * as ns from`: the name is the whole module
                if source == "*" {
                    return Lookup::Found(target, confidence);
                }
                match self.find(target, source) {
                    Lookup::Found(found, sure) => {
                        return Lookup::Found(found, weakest(confidence, sure));
                    }
                    Lookup::Ambiguous => return Lookup::Ambiguous,
                    Lookup::Missing => {}
                }
            }
            // The module it comes from is known even when the declaration is
            // not: a Python submodule, a symbol the parser leaves out
            return sources
                .first()
                .map_or(Lookup::Missing, |&(_, target, confidence)| {
                    Lookup::Found(target, confidence)
                });
        }
        let mut found: Option<(u32, Confidence)> = None;
        for &(target, confidence) in exports.stars.get(&file).map_or(&[][..], Vec::as_slice) {
            match self.find(target, name) {
                Lookup::Found(file, sure) => match found {
                    Some((other, _)) if other != file => return Lookup::Ambiguous,
                    _ => found = Some((file, weakest(confidence, sure))),
                },
                Lookup::Ambiguous => return Lookup::Ambiguous,
                Lookup::Missing => {}
            }
        }
        found.map_or(Lookup::Missing, |(file, confidence)| {
            Lookup::Found(file, confidence)
        })
    }
}

fn weakest(a: Confidence, b: Confidence) -> Confidence {
    if a == Confidence::Exact && b == Confidence::Exact {
        Confidence::Exact
    } else {
        Confidence::Likely
    }
}

/// Which kind an edge keeps when a file imports the same target several
/// ways: the one that weighs most on the structure.
pub(crate) fn strength(kind: EdgeKind) -> u8 {
    match kind {
        EdgeKind::Reexport => 4,
        EdgeKind::Import => 3,
        EdgeKind::Lazy => 2,
        EdgeKind::Dynamic => 1,
        EdgeKind::Type => 0,
    }
}
