//! The dependencies production code imports, counted by package. Only those
//! a manifest of the file's folder or of one above it declares count: the
//! standard library and the runtime's built-in modules never do.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use crate::files::Language;
use crate::lang::Import;
use crate::resolve::{Outcome, package_name};

use super::manifest::python_key;

/// Where a dependency is declared: the manifest file, and whether only for
/// development.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct Source {
    pub manifest: u32,
    pub dev: bool,
}

/// The dependencies the manifests of one folder declare.
#[derive(Debug, Default)]
pub(super) struct Declared {
    pub npm: BTreeMap<String, Source>,
    /// Python projects, by [`python_key`], with the name as declared.
    pub python: HashMap<String, (String, Source)>,
    /// Go modules.
    pub go: Vec<(String, Source)>,
}

impl Declared {
    /// Adds a Python project; a declaration for running wins over one for
    /// development (a project in both `pyproject.toml` and
    /// `requirements-dev.txt`).
    pub fn add_python(&mut self, key: String, name: String, source: Source) {
        match self.python.get(&key) {
            Some((_, known)) if !known.dev || source.dev => {}
            _ => {
                self.python.insert(key, (name, source));
            }
        }
    }
}

/// One dependency imported by production files.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Counted {
    pub package: Option<u32>,
    pub manifest: u32,
    pub name: String,
    pub dev: bool,
    pub files: u32,
}

/// What the dependencies are counted from, by row in the result.
pub(super) struct Input<'a> {
    pub parents: &'a [Option<u32>],
    pub file_dirs: &'a [u32],
    pub languages: &'a [Language],
    pub production: &'a [bool],
    /// The package of each file.
    pub packages: &'a [Option<u32>],
    pub imports: &'a [Vec<Import>],
    pub outcomes: &'a [Vec<Outcome>],
    /// Declared dependencies, by folder.
    pub declared: &'a HashMap<u32, Declared>,
}

/// One row per package, manifest and dependency, sorted by package (`None`
/// first), manifest then name, with the production files that import it.
pub(super) fn count(input: &Input<'_>) -> Vec<Counted> {
    let mut counts: BTreeMap<(Option<u32>, u32, String), (bool, u32)> = BTreeMap::new();
    for (file, (imports, outcomes)) in input.imports.iter().zip(input.outcomes).enumerate() {
        if !input.production[file] || input.declared.is_empty() {
            continue;
        }
        let mut names: BTreeSet<(String, Source)> = BTreeSet::new();
        for (import, outcome) in imports.iter().zip(outcomes) {
            if *outcome != Outcome::External {
                continue;
            }
            let dirs = std::iter::successors(Some(input.file_dirs[file]), |&dir| {
                input.parents[dir as usize]
            });
            if let Some(name) = declared(input.languages[file], &import.specifier, dirs, input) {
                names.insert(name);
            }
        }
        for (name, source) in names {
            let count = counts
                .entry((input.packages[file], source.manifest, name))
                .or_insert((source.dev, 0));
            count.1 += 1;
        }
    }
    counts
        .into_iter()
        .map(|((package, manifest, name), (dev, files))| Counted {
            package,
            manifest,
            name,
            dev,
            files,
        })
        .collect()
}

/// The dependency an import names, as the nearest manifest that declares
/// it writes it, with that manifest.
fn declared(
    language: Language,
    specifier: &str,
    mut dirs: impl Iterator<Item = u32>,
    input: &Input<'_>,
) -> Option<(String, Source)> {
    match language {
        Language::TypeScript | Language::JavaScript => {
            if specifier.starts_with(['.', '/']) || specifier.contains(':') {
                return None;
            }
            let name = package_name(specifier);
            dirs.find_map(|dir| {
                let source = *input.declared.get(&dir)?.npm.get(name)?;
                Some((name.to_owned(), source))
            })
        }
        Language::Python => {
            if specifier.starts_with('.') {
                return None;
            }
            let key = python_key(specifier.split('.').next()?);
            dirs.find_map(|dir| input.declared.get(&dir)?.python.get(&key).cloned())
        }
        Language::Go => dirs.find_map(|dir| {
            input
                .declared
                .get(&dir)?
                .go
                .iter()
                .filter(|(module, _)| {
                    specifier == module.as_str()
                        || specifier
                            .strip_prefix(module.as_str())
                            .is_some_and(|rest| rest.starts_with('/'))
                })
                .max_by_key(|(module, _)| module.len())
                .cloned()
        }),
        Language::Other(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use model::EdgeKind;

    fn import(specifier: &str) -> Import {
        Import {
            specifier: specifier.to_owned(),
            kind: EdgeKind::Import,
            line: 1,
            names: Vec::new(),
            exports: Vec::new(),
        }
    }

    fn source(manifest: u32, dev: bool) -> Source {
        Source { manifest, dev }
    }

    fn counted(package: Option<u32>, manifest: u32, name: &str, dev: bool, files: u32) -> Counted {
        Counted {
            package,
            manifest,
            name: name.to_owned(),
            dev,
            files,
        }
    }

    #[test]
    fn declared_dependencies_count_once_per_file_by_package() {
        // Folders: root 0, apps 1, apps/web 2; files: two in apps/web, one
        // at the root; manifests: 10 at the root, 12 in apps/web
        let parents = [None, Some(0), Some(1)];
        let declared = HashMap::from([
            (
                0,
                Declared {
                    npm: BTreeMap::from([("react".to_owned(), source(10, false))]),
                    ..Declared::default()
                },
            ),
            (
                2,
                Declared {
                    npm: BTreeMap::from([
                        ("next".to_owned(), source(12, false)),
                        ("@acme/ui".to_owned(), source(12, true)),
                    ]),
                    ..Declared::default()
                },
            ),
        ]);
        let imports = vec![
            vec![
                import("next/link"),
                import("next/router"),
                import("react"),
                import("node:fs"),
                import("lodash"),
            ],
            vec![import("@acme/ui/button"), import("./local")],
            vec![import("next")],
        ];
        let outcomes: Vec<Vec<Outcome>> = imports
            .iter()
            .map(|imports| vec![Outcome::External; imports.len()])
            .collect();
        let counts = count(&Input {
            parents: &parents,
            file_dirs: &[2, 2, 0],
            languages: &[Language::TypeScript; 3],
            production: &[true, true, true],
            packages: &[Some(0), Some(0), None],
            imports: &imports,
            outcomes: &outcomes,
            declared: &declared,
        });
        // `react` is declared by the root manifest, the others by the app's
        assert_eq!(
            counts,
            [
                counted(Some(0), 10, "react", false, 1),
                counted(Some(0), 12, "@acme/ui", true, 1),
                counted(Some(0), 12, "next", false, 1),
            ]
        );
    }

    #[test]
    fn a_name_two_manifests_declare_counts_for_each() {
        // A library at the root and its site in `website/` both declare
        // `react`: each file counts for its own manifest
        let parents = [None, Some(0)];
        let react = |manifest| Declared {
            npm: BTreeMap::from([("react".to_owned(), source(manifest, false))]),
            ..Declared::default()
        };
        let declared = HashMap::from([(0, react(10)), (1, react(11))]);
        let imports = vec![
            vec![import("react")],
            vec![import("react")],
            vec![import("react")],
        ];
        let outcomes = vec![vec![Outcome::External]; 3];
        let counts = count(&Input {
            parents: &parents,
            file_dirs: &[0, 1, 1],
            languages: &[Language::TypeScript; 3],
            production: &[true, true, true],
            packages: &[None, None, None],
            imports: &imports,
            outcomes: &outcomes,
            declared: &declared,
        });
        assert_eq!(
            counts,
            [
                counted(None, 10, "react", false, 1),
                counted(None, 11, "react", false, 2),
            ]
        );
    }

    #[test]
    fn python_and_go_match_their_declared_names() {
        let parents = [None];
        let mut python = Declared::default();
        python.add_python(
            "typing-extensions".to_owned(),
            "typing-extensions".to_owned(),
            source(10, false),
        );
        // In `requirements-dev.txt`, then in `pyproject.toml`: for running
        python.add_python(
            "starlette".to_owned(),
            "starlette".to_owned(),
            source(11, true),
        );
        python.add_python(
            "starlette".to_owned(),
            "starlette".to_owned(),
            source(10, false),
        );
        python.add_python(
            "starlette".to_owned(),
            "starlette".to_owned(),
            source(11, true),
        );
        python.go = vec![
            ("github.com/a/b".to_owned(), source(12, false)),
            ("github.com/a/b/v2".to_owned(), source(12, false)),
        ];
        let declared = HashMap::from([(0, python)]);
        let imports = vec![
            vec![
                import("typing_extensions"),
                import("starlette.routing"),
                import("os.path"),
                import(".models"),
            ],
            vec![import("github.com/a/b/v2/sub"), import("github.com/a/bc")],
            vec![import("starlette")],
        ];
        let outcomes: Vec<Vec<Outcome>> = imports
            .iter()
            .map(|imports| vec![Outcome::External; imports.len()])
            .collect();
        let counts = count(&Input {
            parents: &parents,
            file_dirs: &[0, 0, 0],
            languages: &[Language::Python, Language::Go, Language::Python],
            production: &[true, true, false],
            packages: &[None, None, None],
            imports: &imports,
            outcomes: &outcomes,
            declared: &declared,
        });
        assert_eq!(
            counts,
            [
                counted(None, 10, "starlette", false, 1),
                counted(None, 10, "typing-extensions", false, 1),
                counted(None, 12, "github.com/a/b/v2", false, 1),
            ]
        );
    }
}
