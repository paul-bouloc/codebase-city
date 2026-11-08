//! Seeing through barrels: the file that declares each name a barrel
//! exports, followed down chains of re-exports.

use std::collections::{HashMap, HashSet};

use model::Confidence;

use super::Input;
use crate::files::split_path;
use crate::resolve::{Outcome, Target};

/// Re-export chains longer than this are not followed, which bounds the
/// recursion.
const MAX_DEPTH: usize = 256;

/// Steps of lookup through re-exports, over the whole analysis. Past it,
/// imports stay on their barrel: a repository built to make lookups slow
/// cannot hold the analysis. nest takes about 25 000, vscode 16 000.
const MAX_STEPS: u32 = 2_000_000;

/// Where a name a file exports is declared.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Lookup {
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
pub(super) struct Exports<'a> {
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
    pub(super) fn new(input: &Input<'a>) -> Self {
        // A symbol exported only as the default answers to `default`, not
        // to its own name
        let only_default = |file: u32, name: &str| {
            input.defaults[file as usize]
                .as_ref()
                .and_then(|default| default.symbol.as_deref())
                == Some(name)
        };
        let mut declared: HashSet<(u32, &str)> = input
            .symbols
            .file
            .iter()
            .zip(&input.symbols.name)
            .map(|(&file, name)| (file, name.as_str()))
            .filter(|&(file, name)| !only_default(file, name))
            .collect();
        for (file, default) in input.defaults.iter().enumerate() {
            if default.is_some() {
                declared.insert((crate::saturating_u32(file), "default"));
            }
        }
        let mut named: HashMap<_, Vec<_>> = HashMap::new();
        let mut stars: HashMap<_, Vec<_>> = HashMap::new();
        let mut reexporting = HashSet::new();
        for (file, (imports, outcomes)) in input.imports.iter().zip(input.outcomes).enumerate() {
            let file = crate::saturating_u32(file);
            for (import, outcome) in imports.iter().zip(outcomes) {
                let Outcome::Resolved(targets) = outcome else {
                    continue;
                };
                if import.exports.is_empty() {
                    continue;
                }
                let by_name = targets_by_name(input.paths, targets, &import.names);
                for ((name, export), own) in import.names.iter().zip(&import.exports).zip(by_name) {
                    for (target, confidence) in own {
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
pub(super) struct Lookups<'e, 'a> {
    exports: &'e Exports<'a>,
    /// Every lookup is made once: chains of `export *` that meet again
    /// would otherwise be walked once per path, exponentially many.
    memo: HashMap<(u32, &'a str), Lookup>,
    /// The chain followed so far, to stop on a loop.
    visiting: Vec<(u32, &'a str)>,
    /// The shallowest position in `visiting` where a loop was cut since
    /// the current lookup started; `usize::MAX` when none was.
    cut: usize,
    pub(super) steps: u32,
}

impl<'e, 'a> Lookups<'e, 'a> {
    pub(super) fn new(exports: &'e Exports<'a>) -> Self {
        Self {
            exports,
            memo: HashMap::new(),
            visiting: Vec::new(),
            cut: usize::MAX,
            steps: 0,
        }
    }

    /// The file that declares `name`, as `file` exports it.
    ///
    /// A loop of re-exports is cut where it closes. What was found below the
    /// cut is incomplete for the files of the loop, so it is remembered only
    /// once back at the file where the loop started.
    pub(super) fn find(&mut self, file: u32, name: &'a str) -> Lookup {
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
        let depth = self.visiting.len();
        if depth >= MAX_DEPTH {
            self.cut = 0;
            return Lookup::Missing;
        }
        if let Some(open) = self.visiting.iter().position(|&seen| seen == (file, name)) {
            self.cut = self.cut.min(open);
            return Lookup::Missing;
        }
        let outer = std::mem::replace(&mut self.cut, usize::MAX);
        self.visiting.push((file, name));
        let lookup = self.find_reexported(file, name);
        self.visiting.pop();
        let inner = std::mem::replace(&mut self.cut, outer);
        if inner >= depth {
            self.memo.insert((file, name), lookup);
        } else {
            self.cut = self.cut.min(inner);
        }
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
        // `export *` leaves the default export out
        if name == "default" {
            return Lookup::Missing;
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

/// The files each name of an import comes from, among those it resolved
/// to. `from . import a, b` resolves to one module per name: each name goes
/// with its own module, and a name that is not a module with the files no
/// name claims (the package itself). Built in one pass, so a package of
/// thousands of modules stays linear.
pub(super) fn targets_by_name(
    paths: &[&str],
    targets: &[(Target, Confidence)],
    names: &[String],
) -> Vec<Vec<(u32, Confidence)>> {
    let files: Vec<(u32, Confidence)> = targets
        .iter()
        .filter_map(|(target, confidence)| match target {
            Target::File(file) => Some((*file, *confidence)),
            Target::Dir(_) => None,
        })
        .collect();
    if files.len() <= 1 {
        return vec![files; names.len()];
    }
    let wanted: HashSet<&str> = names.iter().map(String::as_str).collect();
    let mut modules: HashMap<&str, Vec<(u32, Confidence)>> = HashMap::new();
    let mut rest = Vec::new();
    for (file, confidence) in files {
        let module = module_name(paths[file as usize]);
        if wanted.contains(module) {
            modules.entry(module).or_default().push((file, confidence));
        } else {
            rest.push((file, confidence));
        }
    }
    names
        .iter()
        .map(|name| modules.get(name.as_str()).unwrap_or(&rest).clone())
        .collect()
}

/// The module a file is, as imports name it: `tides` for `harbor/tides.py`
/// or `harbor/tides/__init__.py`.
fn module_name(path: &str) -> &str {
    let (dir, name) = split_path(path);
    if name.starts_with("__init__.") {
        split_path(dir).1
    } else {
        name.split('.').next().unwrap_or(name)
    }
}

pub(super) fn weakest(a: Confidence, b: Confidence) -> Confidence {
    if a == Confidence::Exact && b == Confidence::Exact {
        Confidence::Exact
    } else {
        Confidence::Likely
    }
}
