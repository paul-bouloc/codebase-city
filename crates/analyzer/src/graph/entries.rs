//! Entry points: where the code starts. Manifests and conventions first,
//! the graph only to confirm them or, without them, to guess (P10).
//!
//! Each signal adds to a score; a file needs 4 to be kept, or, when none
//! has, the best three are. Every entry keeps the reasons it was found by.

mod manifests;

use std::collections::{HashMap, HashSet};

use model::{Entries, EntryReason};

use crate::files::split_path;
use crate::graph::Node;
use crate::graph::reach::{Reach, Units};
use manifests::{join, package_json, pyproject_scripts, python_scripts, setup_cfg_scripts};

/// Entries kept at most.
const KEPT: usize = 5;

/// Score an entry needs to be kept when others have it.
const THRESHOLD: u32 = 4;

/// Kept when no file reaches [`THRESHOLD`].
const FALLBACK: usize = 3;

/// Names of entry points, without their extension.
const CONVENTIONAL: &[&str] = &["main", "index", "server", "app", "cli"];

/// Points of the graph signal, by rank among the files no one imports.
const NO_IMPORTER: &[u32] = &[3, 2, 2, 1, 1];

/// What the entry points are found from, by row in the result.
pub(crate) struct Input<'a> {
    /// Paths of the files, sorted, and of the folders (`""` for the root).
    pub paths: &'a [&'a str],
    pub dir_paths: &'a [&'a str],
    /// The manifests that kept their content, by path.
    pub manifests: &'a [(&'a str, &'a [u8])],
    /// Files that start a program (Go `func main`, Python `__main__` block).
    pub mains: &'a [bool],
    pub barrels: &'a [bool],
    pub units: &'a Units,
    pub reach: Option<&'a Reach>,
}

/// An entry point being scored.
#[derive(Default)]
struct Candidate {
    score: u32,
    reasons: Vec<(EntryReason, u32)>,
    command: Option<String>,
}

pub(crate) fn find(input: &Input<'_>) -> Entries {
    let by_path: HashMap<&str, u32> = input
        .paths
        .iter()
        .enumerate()
        .map(|(row, &path)| (path, crate::saturating_u32(row)))
        .collect();
    let production = |file: u32| input.units.of_file[file as usize].is_some();
    let mut candidates: HashMap<Node, Candidate> = HashMap::new();
    let mut add = |node: Node, reason: EntryReason, points: u32, command: Option<String>| {
        let candidate = candidates.entry(node).or_default();
        if candidate.reasons.iter().any(|&(known, _)| known == reason) {
            return;
        }
        candidate.score += points;
        candidate.reasons.push((reason, points));
        if candidate.command.is_none() {
            candidate.command = command;
        }
    };

    for &(path, content) in input.manifests {
        let (dir, name) = split_path(path);
        let found: Vec<(u32, EntryReason, u32, Option<String>)> = match name {
            "package.json" => package_json(dir, content, &by_path, &production),
            "pyproject.toml" => python_scripts(dir, &pyproject_scripts(content), &by_path)
                .into_iter()
                .map(|(file, command)| (file, EntryReason::PyprojectScript, 5, Some(command)))
                .collect(),
            "setup.cfg" => python_scripts(dir, &setup_cfg_scripts(content), &by_path)
                .into_iter()
                .map(|(file, command)| (file, EntryReason::SetupCfgScript, 5, Some(command)))
                .collect(),
            _ => Vec::new(),
        };
        for (file, reason, points, command) in found {
            if production(file) {
                add(Node::File(file), reason, points, command);
            }
        }
    }

    // Folders at the root of a package, where conventional names count
    let mut roots: HashSet<String> = HashSet::from([String::new(), "src".to_owned()]);
    for &(path, _) in input.manifests {
        let (dir, name) = split_path(path);
        if matches!(
            name,
            "package.json" | "pyproject.toml" | "setup.cfg" | "go.mod"
        ) {
            roots.insert(dir.to_owned());
            roots.insert(join(dir, "src"));
        }
    }
    for (file, &path) in input.paths.iter().enumerate() {
        let file = crate::saturating_u32(file);
        if !production(file) {
            continue;
        }
        let (dir, name) = split_path(path);
        if input.mains[file as usize] {
            if name.ends_with(".go") {
                let (parent, command) = split_path(dir);
                let command = (split_path(parent).1 == "cmd").then(|| command.to_owned());
                add(Node::File(file), EntryReason::GoMain, 5, command);
            } else {
                add(Node::File(file), EntryReason::MainBlock, 3, None);
            }
        }
        match name {
            "__main__.py" => add(Node::File(file), EntryReason::MainModule, 4, None),
            "manage.py" => add(Node::File(file), EntryReason::Framework, 4, None),
            // A Django project's, beside its `manage.py` or one folder
            // below; a library's `wsgi.py` adapts to WSGI and starts nothing
            "wsgi.py" | "asgi.py" => {
                let parent = split_path(dir).0;
                if by_path.contains_key(join(dir, "manage.py").as_str())
                    || by_path.contains_key(join(parent, "manage.py").as_str())
                {
                    add(Node::File(file), EntryReason::Framework, 4, None);
                }
            }
            _ => {}
        }
        // `app.ts`, not `app.controller.ts`
        let stem = name.rsplit_once('.').map_or(name, |(stem, _)| stem);
        if CONVENTIONAL.contains(&stem) && roots.contains(dir) {
            add(Node::File(file), EntryReason::ConventionalName, 2, None);
        }
    }

    // The graph: units no production file imports, that depend on the most.
    // What a barrel re-exports is what the facade offers: being re-exported
    // does not count as being imported
    let units = input.units;
    let is_barrel = |unit: usize| match units.nodes[unit] {
        Node::File(file) => input.barrels[file as usize],
        Node::Dir(_) => false,
    };
    let mut imported = vec![false; units.len()];
    for unit in 0..crate::saturating_u32(units.len()) {
        if is_barrel(unit as usize) {
            continue;
        }
        for &to in units.imports(unit) {
            imported[to as usize] = true;
        }
    }
    let dependencies = |unit: usize| input.reach.map_or(0, |reach| reach.dependencies[unit]);
    // A Go program is its file with `func main`, not its package
    let mut programs: HashMap<u32, u32> = HashMap::new();
    for (file, unit) in units.of_file.iter().enumerate() {
        if let Some(unit) = unit
            && input.mains[file]
        {
            programs.entry(*unit).or_insert(crate::saturating_u32(file));
        }
    }
    let node_of = |unit: usize| match units.nodes[unit] {
        Node::Dir(dir) => programs
            .get(&crate::saturating_u32(unit))
            .map_or(Node::Dir(dir), |&file| Node::File(file)),
        node => node,
    };
    let path_of = |node: Node| match node {
        Node::File(file) => input.paths[file as usize].to_owned(),
        Node::Dir(dir) => input.dir_paths[dir as usize].to_owned(),
    };
    let mut roots_of_graph: Vec<(u32, String, usize)> = (0..units.len())
        .filter(|&unit| !imported[unit] && !is_barrel(unit) && dependencies(unit) > 0)
        .map(|unit| (dependencies(unit), path_of(node_of(unit)), unit))
        .collect();
    roots_of_graph.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    for (&(_, _, unit), &points) in roots_of_graph.iter().zip(NO_IMPORTER) {
        add(node_of(unit), EntryReason::NoImporter, points, None);
    }

    // The unit of each candidate, for its dependencies
    let unit_of = |node: Node| match node {
        Node::File(file) => units.of_file[file as usize].map(|unit| unit as usize),
        Node::Dir(dir) => units
            .nodes
            .iter()
            .position(|&known| known == Node::Dir(dir)),
    };
    let mut ranked: Vec<(Node, Candidate, u32, String)> = candidates
        .into_iter()
        .map(|(node, candidate)| {
            let depends = unit_of(node).map_or(0, dependencies);
            (node, candidate, depends, path_of(node))
        })
        .collect();
    ranked.sort_by(|a, b| {
        b.1.score
            .cmp(&a.1.score)
            .then_with(|| b.2.cmp(&a.2))
            .then_with(|| a.3.cmp(&b.3))
    });
    let kept = match ranked
        .iter()
        .filter(|entry| entry.1.score >= THRESHOLD)
        .count()
    {
        0 => FALLBACK,
        sure => sure.min(KEPT),
    };

    let mut entries = Entries::default();
    for (node, mut candidate, _, _) in ranked.into_iter().take(kept) {
        let (file, dir) = match node {
            Node::File(file) => (Some(file), None),
            Node::Dir(dir) => (None, Some(dir)),
        };
        // The strongest reason first; equal ones in a fixed order
        candidate
            .reasons
            .sort_by_key(|&(reason, points)| (std::cmp::Reverse(points), reason as u8));
        entries.file.push(file);
        entries.dir.push(dir);
        entries.reasons.push(
            candidate
                .reasons
                .into_iter()
                .map(|(reason, _)| reason)
                .collect(),
        );
        entries.command.push(candidate.command);
    }
    entries
}
