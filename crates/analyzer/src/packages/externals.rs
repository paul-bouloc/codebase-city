//! The dependencies production code imports, counted by package. Only those
//! a manifest of the file's folder or of one above it declares count: the
//! standard library and the runtime's built-in modules never do.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use crate::files::Language;
use crate::lang::Import;
use crate::resolve::{Outcome, package_name};

use super::manifest::python_key;

/// The dependencies the manifests of one folder declare.
#[derive(Debug, Default)]
pub(super) struct Declared {
    pub npm: BTreeSet<String>,
    /// Python projects, by [`python_key`], with the name as declared.
    pub python: HashMap<String, String>,
    /// Go modules.
    pub go: Vec<String>,
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

/// One row per package and dependency, sorted by package (`None` first)
/// then by name, with the production files that import it.
pub(super) fn count(input: &Input<'_>) -> Vec<(Option<u32>, String, u32)> {
    let mut counts: BTreeMap<(Option<u32>, String), u32> = BTreeMap::new();
    for (file, (imports, outcomes)) in input.imports.iter().zip(input.outcomes).enumerate() {
        if !input.production[file] || input.declared.is_empty() {
            continue;
        }
        let mut names: BTreeSet<String> = BTreeSet::new();
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
        for name in names {
            *counts.entry((input.packages[file], name)).or_default() += 1;
        }
    }
    counts
        .into_iter()
        .map(|((package, name), files)| (package, name, files))
        .collect()
}

/// The dependency an import names, as the nearest manifest that declares
/// it writes it.
fn declared(
    language: Language,
    specifier: &str,
    mut dirs: impl Iterator<Item = u32>,
    input: &Input<'_>,
) -> Option<String> {
    match language {
        Language::TypeScript | Language::JavaScript => {
            if specifier.starts_with(['.', '/']) || specifier.contains(':') {
                return None;
            }
            let name = package_name(specifier);
            dirs.find(|dir| {
                input
                    .declared
                    .get(dir)
                    .is_some_and(|declared| declared.npm.contains(name))
            })
            .map(|_| name.to_owned())
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
                .filter(|module| {
                    specifier == module.as_str()
                        || specifier
                            .strip_prefix(module.as_str())
                            .is_some_and(|rest| rest.starts_with('/'))
                })
                .max_by_key(|module| module.len())
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

    #[test]
    fn declared_dependencies_count_once_per_file_by_package() {
        // Folders: root 0, apps 1, apps/web 2; files: two in apps/web, one at the root
        let parents = [None, Some(0), Some(1)];
        let declared = HashMap::from([
            (
                0,
                Declared {
                    npm: BTreeSet::from(["react".to_owned()]),
                    ..Declared::default()
                },
            ),
            (
                2,
                Declared {
                    npm: BTreeSet::from(["next".to_owned(), "@acme/ui".to_owned()]),
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
        let counted = count(&Input {
            parents: &parents,
            file_dirs: &[2, 2, 0],
            languages: &[Language::TypeScript; 3],
            production: &[true, true, true],
            packages: &[Some(0), Some(0), None],
            imports: &imports,
            outcomes: &outcomes,
            declared: &declared,
        });
        assert_eq!(
            counted,
            [
                (Some(0), "@acme/ui".to_owned(), 1),
                (Some(0), "next".to_owned(), 1),
                (Some(0), "react".to_owned(), 1),
            ]
        );
    }

    #[test]
    fn python_and_go_match_their_declared_names() {
        let parents = [None];
        let declared = HashMap::from([(
            0,
            Declared {
                python: HashMap::from([
                    (
                        "typing-extensions".to_owned(),
                        "typing-extensions".to_owned(),
                    ),
                    ("starlette".to_owned(), "starlette".to_owned()),
                ]),
                go: vec!["github.com/a/b".to_owned(), "github.com/a/b/v2".to_owned()],
                ..Declared::default()
            },
        )]);
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
        let counted = count(&Input {
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
            counted,
            [
                (None, "github.com/a/b/v2".to_owned(), 1),
                (None, "starlette".to_owned(), 1),
                (None, "typing-extensions".to_owned(), 1),
            ]
        );
    }
}
