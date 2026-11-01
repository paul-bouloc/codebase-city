//! Resolving imports to the files and folders of the repository, one module
//! per language, on an index of the repository built once.
//!
//! An import either resolves (to one target or more), points to a
//! dependency outside the repository, or could not be resolved. When the
//! language's own rules fail, a last try looks for the one file whose path
//! ends like the import: a match is only "likely".

mod go;
mod javascript;
mod python;

use std::collections::{HashMap, HashSet};

use model::Confidence;

use crate::files::{Language, split_path};
use crate::lang::Import;

/// What an import points to.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub(crate) enum Target {
    /// A file, by its row in the sorted file list.
    File(u32),
    /// A folder, by its path from the root (`""` for the root).
    Dir(String),
}

/// How an import was resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Outcome {
    /// One target or more: a Python `from a import b, c` may import two
    /// modules.
    Resolved(Vec<(Target, Confidence)>),
    /// A dependency that is not in the repository.
    External,
    /// Looks internal, but no file matches.
    Unresolved,
}

/// The files of the repository, looked up by path, folder and name.
pub(crate) struct Index<'a> {
    /// Paths of the files, sorted: a file's row is its position.
    paths: &'a [&'a str],
    by_path: HashMap<&'a str, u32>,
    /// Every folder holding a file, at any depth, with the root as `""`.
    dirs: HashSet<&'a str>,
    /// Rows of the files directly in each folder.
    in_dir: HashMap<&'a str, Vec<u32>>,
    /// Rows of the files with each name.
    by_name: HashMap<&'a str, Vec<u32>>,
}

impl<'a> Index<'a> {
    /// `paths` must be sorted, which [`crate::analyze`] does first.
    pub(crate) fn new(paths: &'a [&'a str]) -> Self {
        let mut index = Self {
            paths,
            by_path: HashMap::with_capacity(paths.len()),
            dirs: HashSet::from([""]),
            in_dir: HashMap::new(),
            by_name: HashMap::with_capacity(paths.len()),
        };
        for (row, &path) in paths.iter().enumerate() {
            let row = crate::saturating_u32(row);
            let (dir, name) = split_path(path);
            index.by_path.insert(path, row);
            index.in_dir.entry(dir).or_default().push(row);
            index.by_name.entry(name).or_default().push(row);
            let mut ancestor = dir;
            while index.dirs.insert(ancestor) {
                ancestor = split_path(ancestor).0;
            }
        }
        index
    }

    fn file(&self, path: &str) -> Option<u32> {
        self.by_path.get(path).copied()
    }

    fn path(&self, row: u32) -> &'a str {
        self.paths[row as usize]
    }

    fn is_dir(&self, path: &str) -> bool {
        self.dirs.contains(path)
    }

    /// The files directly in a folder.
    fn files_in(&self, dir: &str) -> &[u32] {
        self.in_dir.get(dir).map_or(&[], Vec::as_slice)
    }

    /// The one file whose path is `suffix` followed by one of `endings`, or
    /// ends with `/` and that; `None` when there is none or several.
    fn by_suffix(&self, suffix: &str, endings: &[&str]) -> Option<u32> {
        let mut found = None;
        for ending in endings {
            let wanted = format!("{suffix}{ending}");
            let name = split_path(&wanted).1;
            for &row in self.by_name.get(name).map_or(&[][..], Vec::as_slice) {
                let path = self.path(row);
                let matches = path
                    .strip_suffix(wanted.as_str())
                    .is_some_and(|rest| rest.is_empty() || rest.ends_with('/'));
                if matches {
                    match found {
                        None => found = Some(row),
                        Some(other) if other != row => return None,
                        Some(_) => {}
                    }
                }
            }
        }
        found
    }
}

/// `path` inside the folder `dir`, which may be the root.
fn under(dir: &str, path: &str) -> String {
    match (dir.is_empty(), path.is_empty()) {
        (true, _) => path.to_owned(),
        (false, true) => dir.to_owned(),
        (false, false) => format!("{dir}/{path}"),
    }
}

/// `dir` joined with a relative path, `.` and `..` resolved; `None` when it
/// climbs above the root.
fn join(dir: &str, relative: &str) -> Option<String> {
    let mut parts: Vec<&str> = dir.split('/').filter(|part| !part.is_empty()).collect();
    for part in relative.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            _ => parts.push(part),
        }
    }
    Some(parts.join("/"))
}

/// Resolves imports for every analyzed language. Built once per analysis,
/// then shared by the threads.
pub(crate) struct Resolver<'a> {
    index: &'a Index<'a>,
    javascript: javascript::Resolver,
    python: python::Resolver<'a>,
    go: go::Resolver,
}

impl<'a> Resolver<'a> {
    /// `manifests` are the contents of the configuration files resolution
    /// reads (`package.json`, `tsconfig.json`, `go.mod`…), by path.
    pub(crate) fn new(index: &'a Index<'a>, manifests: &HashMap<&str, &[u8]>) -> Self {
        Self {
            index,
            javascript: javascript::Resolver::new(index, manifests),
            python: python::Resolver::new(index),
            go: go::Resolver::new(manifests),
        }
    }

    /// Resolves one import of the file at `path`.
    pub(crate) fn resolve(&self, path: &str, language: Language, import: &Import) -> Outcome {
        match language {
            Language::TypeScript | Language::JavaScript => {
                self.javascript.resolve(self.index, path, &import.specifier)
            }
            Language::Python => self.python.resolve(path, import),
            Language::Go => self.go.resolve(self.index, &import.specifier),
            Language::Other(_) => Outcome::Unresolved,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_resolves_dots_and_stays_in_the_repository() {
        assert_eq!(join("src/a", "../b/./c").as_deref(), Some("src/b/c"));
        assert_eq!(join("", "a").as_deref(), Some("a"));
        assert_eq!(join("src", "..").as_deref(), Some(""));
        assert_eq!(join("src", "../.."), None);
    }

    #[test]
    fn a_suffix_matches_one_file_only() {
        let paths = [
            "app/components/Button.tsx",
            "lib/util.ts",
            "lib/util/index.ts",
            "other/myutil.ts",
            "pkg/util.ts",
        ];
        let index = Index::new(&paths);
        assert_eq!(
            index.by_suffix("components/Button", &[".ts", ".tsx"]),
            Some(0)
        );
        // `myutil.ts` does not end with `/util.ts`
        assert_eq!(index.by_suffix("lib/util", &[".ts"]), Some(1));
        assert_eq!(index.by_suffix("util", &[".ts"]), None);
        assert_eq!(index.by_suffix("lib/util", &[".ts", "/index.ts"]), None);
        assert_eq!(index.by_suffix("missing", &[".ts"]), None);
    }

    #[test]
    fn the_index_knows_every_folder() {
        let paths = ["a/b/c.go", "d.go"];
        let index = Index::new(&paths);
        assert!(index.is_dir("") && index.is_dir("a") && index.is_dir("a/b"));
        assert!(!index.is_dir("a/b/c.go"));
        assert_eq!(index.files_in("a/b"), [0]);
        assert_eq!(index.files_in(""), [1]);
    }
}
