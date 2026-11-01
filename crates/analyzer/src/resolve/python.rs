//! Python: a module `a.b.c` is `a/b/c.py` or the package `a/b/c/__init__.py`,
//! under one of the folders Python would search. A relative import starts
//! from the importing file's package.

use std::collections::HashSet;

use model::Confidence;

use super::{Index, Outcome, Target, join, under};
use crate::files::split_path;
use crate::lang::Import;

pub(super) struct Resolver<'a> {
    index: &'a Index<'a>,
    /// Folders absolute imports start from: the root, `src`, and the parent
    /// of every top-level package (a package whose parent is not one).
    roots: Vec<&'a str>,
}

impl<'a> Resolver<'a> {
    pub(super) fn new(index: &'a Index<'a>) -> Self {
        let mut roots = vec!["", "src"];
        let mut seen: HashSet<&str> = roots.iter().copied().collect();
        for &path in index.paths {
            let (package, name) = split_path(path);
            if name != "__init__.py" || package.is_empty() {
                continue;
            }
            let parent = split_path(package).0;
            if index.file(&init(parent)).is_none() && seen.insert(parent) {
                roots.push(parent);
            }
        }
        // The paths are sorted, so the roots come in a stable order
        Self { index, roots }
    }

    pub(super) fn resolve(&self, path: &str, import: &Import) -> Outcome {
        let specifier = import.specifier.as_str();
        let dots = specifier.len() - specifier.trim_start_matches('.').len();
        let module = specifier[dots..].replace('.', "/");
        if dots > 0 {
            // `.` is the importing file's folder, each further dot its parent
            let up = "../".repeat(dots - 1);
            let Some(base) = join(split_path(path).0, &format!("{up}{module}")) else {
                return Outcome::Unresolved;
            };
            return match self.targets(&base, &import.names) {
                Some(targets) => Outcome::Resolved(exact(targets)),
                None => Outcome::Unresolved,
            };
        }

        for root in &self.roots {
            if let Some(targets) = self.targets(&under(root, &module), &import.names) {
                return Outcome::Resolved(exact(targets));
            }
        }
        let top = module.split('/').next().unwrap_or_default();
        // A package or a module of the repository; a mere folder with the
        // same name (`docs/opentelemetry`) is not enough
        let internal = self
            .roots
            .iter()
            .any(|root| self.module(&under(root, top)).is_some());
        // A script imports the modules next to it: `import helpers`
        let beside = under(split_path(path).0, &module);
        if let Some(row) = self.module(&beside) {
            return Outcome::Resolved(vec![(Target::File(row), Confidence::Likely)]);
        }
        if (internal || module.contains('/'))
            && let Some(row) = self.index.by_suffix(&module, &[".py", "/__init__.py"])
        {
            return Outcome::Resolved(vec![(Target::File(row), Confidence::Likely)]);
        }
        if internal {
            Outcome::Unresolved
        } else {
            Outcome::External
        }
    }

    /// The files `from base import names` loads: each name that is a
    /// module of its own, and `base` itself for the other names. `None`
    /// when nothing exists.
    fn targets(&self, base: &str, names: &[String]) -> Option<Vec<u32>> {
        let mut targets = Vec::new();
        let mut needs_base = names.is_empty();
        for name in names {
            match self.module(&under(base, name)) {
                Some(row) if name != "*" => targets.push(row),
                _ => needs_base = true,
            }
        }
        if needs_base {
            match self.module(base) {
                Some(row) => targets.push(row),
                // `from . import a` in a folder without `__init__.py`
                None if targets.is_empty() => return None,
                None => {}
            }
        }
        targets.sort_unstable();
        targets.dedup();
        Some(targets)
    }

    /// The file of the module at `path` (without extension).
    fn module(&self, path: &str) -> Option<u32> {
        if path.is_empty() {
            return self.index.file("__init__.py");
        }
        self.index
            .file(&format!("{path}.py"))
            .or_else(|| self.index.file(&init(path)))
    }
}

fn exact(rows: Vec<u32>) -> Vec<(Target, Confidence)> {
    rows.into_iter()
        .map(|row| (Target::File(row), Confidence::Exact))
        .collect()
}

fn init(package: &str) -> String {
    under(package, "__init__.py")
}
