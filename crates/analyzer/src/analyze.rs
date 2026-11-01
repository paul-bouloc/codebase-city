//! Assembling the analysis result from the files of a repository.

use std::collections::{BTreeMap, HashMap};

use model::{
    AnalysisResult, Confidence, Dirs, EdgeKind, Edges, FORMAT_VERSION, Files, Ignored, Repo, Stats,
    Symbols,
};
use rayon::prelude::*;

use crate::files::{SourceFile, split_path};
use crate::graph::{self, BarrelReport, Graph, strength};
use crate::lang::{self, Parsed};
use crate::resolve::{self, Outcome, Target};
use crate::saturating_u32 as index;
use crate::scope;

/// Version of the algorithms. Bumped whenever a change would give another
/// result for the same commit, so stored results are recomputed.
pub const ANALYZER_VERSION: &str = "0.3.0";

/// What an analysis found beyond its result.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Report {
    pub imports: ImportReport,
    pub barrels: BarrelReport,
    /// The import graph, barrels seen through, that rankings use.
    pub graph: Graph,
}

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

/// Analyzes the files of one commit. The result does not depend on the
/// order of `files`: they are sorted by path first.
pub fn analyze(
    repo: Repo,
    sha: String,
    files: Vec<SourceFile>,
    ignored: Ignored,
) -> AnalysisResult {
    analyze_with_report(repo, sha, files, ignored).0
}

/// [`analyze`], with the import graph and reports on how imports were
/// resolved and seen through barrels.
pub fn analyze_with_report(
    repo: Repo,
    sha: String,
    mut files: Vec<SourceFile>,
    ignored: Ignored,
) -> (AnalysisResult, Report) {
    files.sort_by(|a, b| a.path.cmp(&b.path));
    // `collect` keeps the order of the files, whatever the scheduling. Each
    // content is freed once parsed; the manifests keep theirs for the
    // resolution
    let parsed: Vec<Option<Parsed>> = files
        .par_iter_mut()
        .map(|file| {
            if !file.language.is_analyzed() {
                return None;
            }
            let content = file.content.take()?;
            lang::parse(&file.path, file.language, &content)
        })
        .collect();

    let outcomes = resolve_imports(&files, &parsed);

    let mut dirs = DirTree::new();
    let mut languages: Vec<String> = Vec::new();
    let mut table = Files::default();
    let mut symbols = Symbols::default();
    let mut imports = Vec::with_capacity(files.len());
    let mut barrels = Vec::with_capacity(files.len());
    let mut defaults = Vec::with_capacity(files.len());
    for (row, (file, parsed)) in files.iter().zip(parsed).enumerate() {
        let (dir_path, name) = split_path(&file.path);
        let language = file.language.name();
        let language = match languages.iter().position(|known| known == language) {
            Some(index) => index,
            None => {
                languages.push(language.to_owned());
                languages.len() - 1
            }
        };
        table.dir.push(dirs.index(dir_path));
        table.name.push(name.to_owned());
        table.language.push(index(language));
        table.lines.push(file.lines);
        table.generated.push(file.generated);
        table.scope.push(scope::of(&file.path));
        barrels.push(parsed.as_ref().is_some_and(|parsed| parsed.barrel));
        defaults.push(
            parsed
                .as_ref()
                .and_then(|parsed| parsed.default_export.clone()),
        );
        match parsed {
            Some(parsed) => {
                table.complexity.push(Some(parsed.complexity));
                table.header.push(parsed.header);
                for symbol in parsed.symbols {
                    symbols.file.push(index(row));
                    symbols.name.push(symbol.name);
                    symbols.kind.push(symbol.kind);
                    symbols.line.push(symbol.line);
                }
                imports.push(parsed.imports);
            }
            None => {
                table.complexity.push(None);
                table.header.push(None);
                imports.push(Vec::new());
            }
        }
    }

    let mut report = ImportReport::default();
    let mut by_kind: BTreeMap<u8, (EdgeKind, u32)> = BTreeMap::new();
    let mut unresolved: HashMap<&str, u32> = HashMap::new();
    let mut undeclared: HashMap<&str, u32> = HashMap::new();
    // Importing file, then folder targets after file targets, then index
    let mut edges: BTreeMap<(u32, bool, u32), (EdgeKind, Confidence)> = BTreeMap::new();
    for (from, (imports, outcomes)) in imports.iter().zip(&outcomes).enumerate() {
        let from = index(from);
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
                    Target::Dir(path) => match dirs.by_path.get(path.as_str()) {
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

    let paths: Vec<&str> = files.iter().map(|file| file.path.as_str()).collect();
    let (graph, barrel_report) = graph::build(&graph::Input {
        paths: &paths,
        scopes: &table.scope,
        generated: &table.generated,
        barrels: &barrels,
        defaults: &defaults,
        symbols: &symbols,
        imports: &imports,
        outcomes: &outcomes,
        dirs: &dirs.by_path,
    });

    let mut table_edges = Edges::default();
    for ((from, is_dir, target), (kind, confidence)) in edges {
        table_edges.from.push(from);
        table_edges.to.push((!is_dir).then_some(target));
        table_edges.to_dir.push(is_dir.then_some(target));
        table_edges.kind.push(kind);
        table_edges.confidence.push(confidence);
    }

    let result = AnalysisResult {
        format_version: FORMAT_VERSION,
        analyzer_version: ANALYZER_VERSION.to_owned(),
        repo,
        sha,
        dirs: dirs.dirs,
        languages,
        files: table,
        symbols,
        edges: table_edges,
        stats: Stats {
            ignored,
            imports_total: report.exact + report.likely + report.external + report.unresolved,
            imports_resolved: report.exact + report.likely,
            imports_external: report.external,
        },
    };
    let report = Report {
        imports: report,
        barrels: barrel_report,
        graph,
    };
    (result, report)
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

/// The outcome of every import of every file, in the same order.
fn resolve_imports(files: &[SourceFile], parsed: &[Option<Parsed>]) -> Vec<Vec<Outcome>> {
    let paths: Vec<&str> = files.iter().map(|file| file.path.as_str()).collect();
    let manifests: HashMap<&str, &[u8]> = files
        .iter()
        .filter_map(|file| Some((file.path.as_str(), file.content.as_deref()?)))
        .collect();
    let index = resolve::Index::new(&paths);
    let resolver = resolve::Resolver::new(&index, &manifests);
    files
        .par_iter()
        .zip(parsed)
        .map(|(file, parsed)| {
            parsed.as_ref().map_or_else(Vec::new, |parsed| {
                parsed
                    .imports
                    .iter()
                    .map(|import| resolver.resolve(&file.path, file.language, import))
                    .collect()
            })
        })
        .collect()
}

/// The folder table, built as files come: a folder is added the first time
/// a path goes through it, so it always comes after its parent.
struct DirTree {
    dirs: Dirs,
    by_path: HashMap<String, u32>,
}

impl DirTree {
    fn new() -> Self {
        Self {
            dirs: Dirs {
                parent: vec![None],
                name: vec![String::new()],
            },
            by_path: HashMap::from([(String::new(), 0)]),
        }
    }

    /// The row of the folder at `path` (`""` for the root), added with its
    /// missing ancestors.
    fn index(&mut self, path: &str) -> u32 {
        if let Some(&row) = self.by_path.get(path) {
            return row;
        }
        let (parent_path, name) = split_path(path);
        let parent = self.index(parent_path);
        let row = index(self.dirs.parent.len());
        self.dirs.parent.push(Some(parent));
        self.dirs.name.push(name.to_owned());
        self.by_path.insert(path.to_owned(), row);
        row
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files::Language;
    use model::Scope;

    fn file(path: &str, content: Option<&str>) -> SourceFile {
        SourceFile {
            path: path.to_owned(),
            language: Language::of(path),
            lines: content.map_or(10, |content| crate::files::count_lines(content.as_bytes())),
            generated: path.contains("generated"),
            content: content.map(|content| content.as_bytes().to_vec()),
        }
    }

    fn repo_files() -> Vec<SourceFile> {
        vec![
            file("README.md", None),
            file(
                "src/main.ts",
                Some("// Starts the app.\n\nexport function main() {\n  if (a) b()\n}\n"),
            ),
            file(
                "src/core/store.ts",
                Some("export class Store {}\nexport const MAX = 1\n"),
            ),
            file("src/generated/schema.ts", Some("export type Schema = {}\n")),
            file("tools/build.py", Some("def build():\n    pass\n")),
            file("tools/big.go", None),
        ]
    }

    fn result(files: Vec<SourceFile>) -> AnalysisResult {
        analyze(
            Repo {
                owner: "acme".to_owned(),
                name: "app".to_owned(),
            },
            "0".repeat(40),
            files,
            Ignored {
                vendored: 2,
                ..Ignored::default()
            },
        )
    }

    #[test]
    fn the_result_is_valid() {
        let result = result(repo_files());
        assert_eq!(result.validate(), Ok(()));
        assert_eq!(result.stats.ignored.vendored, 2);
        assert!(result.edges.from.is_empty());
    }

    #[test]
    fn folders_come_after_their_parent() {
        let result = result(repo_files());
        let paths: Vec<String> = (0..result.dirs.name.len())
            .map(|row| {
                let mut parts = Vec::new();
                let mut current = Some(index(row));
                while let Some(dir) = current {
                    parts.push(result.dirs.name[dir as usize].as_str());
                    current = result.dirs.parent[dir as usize];
                }
                parts.reverse();
                parts.join("/")
            })
            .collect();
        assert_eq!(paths, ["", "/src", "/src/core", "/src/generated", "/tools"]);
    }

    #[test]
    fn files_are_sorted_by_path_with_their_measures() {
        let result = result(repo_files());
        let files = &result.files;
        assert_eq!(
            files.name,
            [
                "README.md",
                "store.ts",
                "schema.ts",
                "main.ts",
                "big.go",
                "build.py"
            ]
        );
        assert_eq!(result.languages, ["Markdown", "TypeScript", "Go", "Python"]);
        assert_eq!(files.language, [0, 1, 1, 1, 2, 3]);
        // Not analyzed, and analyzed but without content
        assert_eq!(
            files.complexity,
            [None, Some(1), Some(1), Some(2), None, Some(1)]
        );
        assert_eq!(files.header[3].as_deref(), Some("// Starts the app."));
        assert_eq!(files.generated, [false, false, true, false, false, false]);
        assert_eq!(
            files.scope,
            [
                Scope::Docs,
                Scope::Source,
                Scope::Source,
                Scope::Source,
                Scope::Source,
                Scope::Source
            ]
        );
    }

    #[test]
    fn symbols_are_sorted_by_file_then_line() {
        let result = result(repo_files());
        let symbols = &result.symbols;
        assert_eq!(symbols.file, [1, 1, 2, 3, 5]);
        assert_eq!(symbols.name, ["Store", "MAX", "Schema", "main", "build"]);
        assert_eq!(symbols.line, [1, 2, 1, 3, 1]);
    }

    #[test]
    fn the_order_of_the_files_does_not_matter() {
        let expected = serde_json::to_string(&result(repo_files())).unwrap();
        let mut files = repo_files();
        files.reverse();
        files.swap(1, 4);
        assert_eq!(serde_json::to_string(&result(files)).unwrap(), expected);
    }
}
