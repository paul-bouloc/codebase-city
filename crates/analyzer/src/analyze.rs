//! Assembling the analysis result from the files of a repository.

use std::collections::HashMap;

use model::{
    AnalysisResult, Dirs, Edges, FORMAT_VERSION, Files, Ignored, Islands, Repo, Roles, Scope,
    Stats, Symbols, Tour,
};
use rayon::prelude::*;

use crate::files::{Language, SourceFile, scope, split_path};
use crate::graph::cycles;
use crate::graph::edges::{self, ImportReport};
use crate::graph::entries;
use crate::graph::reach::{self, Reach, Units};
use crate::graph::roles::{self, RolesReport};
use crate::graph::{self, BarrelReport, Graph, Node};
use crate::islands;
use crate::lang::{self, Parsed};
use crate::layout;
use crate::packages;
use crate::resolve;
use crate::saturating_u32 as index;

/// Version of the algorithms. Bumped whenever a change would give another
/// result for the same commit, so stored results are recomputed.
pub const ANALYZER_VERSION: &str = "0.14.0";

/// What an analysis found beyond its result.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Report {
    pub imports: ImportReport,
    pub barrels: BarrelReport,
    /// The import graph, barrels seen through, that rankings use.
    pub graph: Graph,
    pub roles: RolesReport,
}

/// Analyzes the files of one commit. The result does not depend on the
/// order of `files`: they are sorted by path first. The files are those kept
/// by [`crate::files::classify_path`]: folders are indexed by their full path,
/// so a file deeper than [`crate::files::MAX_DEPTH`] costs memory with the
/// square of its depth.
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

    let outcomes = resolve::imports(&files, &parsed);

    let mut dirs = DirTree::new();
    let mut languages: Vec<String> = Vec::new();
    let mut table = Files::default();
    let mut symbols = Symbols::default();
    let mut imports = Vec::with_capacity(files.len());
    let mut barrels = Vec::with_capacity(files.len());
    let mut defaults = Vec::with_capacity(files.len());
    let mut mains = Vec::with_capacity(files.len());
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
        mains.push(parsed.as_ref().is_some_and(|parsed| parsed.main));
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

    let (edges, report) = edges::edges(&imports, &outcomes, &dirs.by_path);

    let paths: Vec<&str> = files.iter().map(|file| file.path.as_str()).collect();
    let mut dir_paths = vec![""; dirs.dirs.parent.len()];
    for (path, &dir) in &dirs.by_path {
        dir_paths[dir as usize] = path.as_str();
    }
    let tooling = scope::tooling(
        &paths,
        &table.scope,
        edges.keys().map(|&(from, is_dir, target)| {
            let dir = if is_dir {
                dir_paths[target as usize]
            } else {
                split_path(paths[target as usize]).0
            };
            (from, dir)
        }),
    );
    for (scope, path) in table.scope.iter_mut().zip(&paths) {
        if *scope == Scope::Source && scope::is_tooling(split_path(path).0, &tooling) {
            *scope = Scope::Build;
        }
    }

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
        tooling: &tooling,
    });

    let mut table_edges = Edges::default();
    for ((from, is_dir, target), (kind, confidence)) in edges {
        table_edges.from.push(from);
        table_edges.to.push((!is_dir).then_some(target));
        table_edges.to_dir.push(is_dir.then_some(target));
        table_edges.kind.push(kind);
        table_edges.confidence.push(confidence);
    }

    let packages: Vec<bool> = files
        .iter()
        .map(|file| file.language == Language::Go)
        .collect();
    let units = Units::new(&graph, &table.dir, &packages);
    let facades: Vec<bool> = units
        .nodes
        .iter()
        .map(|node| matches!(node, Node::File(file) if barrels[*file as usize]))
        .collect();
    let reach = reach::reach(&units, &facades);
    let per_file = |count: fn(&Reach) -> &Vec<u32>| -> Vec<Option<u32>> {
        units
            .of_file
            .iter()
            .map(|unit| Some(count(reach.as_ref()?)[(*unit)? as usize]))
            .collect()
    };
    table.dependents = per_file(|reach| &reach.dependents);
    table.dependencies = per_file(|reach| &reach.dependencies);
    let (foundations, conductors, roles_report) = roles::rank(
        &units,
        reach.as_ref(),
        &roles::Context {
            file_dirs: &table.dir,
            barrels: &barrels,
            file_paths: &paths,
            dir_paths: &dir_paths,
        },
    );
    // Analyzed files gave their content to the parser: what is left is the
    // manifests'
    let manifests: Vec<(&str, &[u8])> = files
        .iter()
        .filter_map(|file| Some((file.path.as_str(), file.content.as_deref()?)))
        .collect();
    let entries = entries::find(&entries::Input {
        paths: &paths,
        dir_paths: &dir_paths,
        manifests: &manifests,
        mains: &mains,
        barrels: &barrels,
        units: &units,
        reach: reach.as_ref(),
    });
    table.barrel = barrels;

    let production: Vec<bool> = (0..files.len())
        .map(|file| graph.is_production(index(file)))
        .collect();
    let file_languages: Vec<Language> = files.iter().map(|file| file.language).collect();
    let import_dirs: Vec<(u32, u32)> = table_edges
        .from
        .iter()
        .zip(table_edges.to.iter().zip(&table_edges.to_dir))
        .filter_map(|(&from, (to, to_dir))| {
            let dir = to.map(|to| table.dir[to as usize]).or(*to_dir)?;
            Some((from, dir))
        })
        .collect();
    let found = packages::find(&packages::Input {
        repo: &repo.name,
        paths: &paths,
        dir_paths: &dir_paths,
        parents: &dirs.dirs.parent,
        file_dirs: &table.dir,
        languages: &file_languages,
        manifests: &manifests,
        production: &production,
        mains: &mains,
        imports: &imports,
        outcomes: &outcomes,
        links: &import_dirs,
    });
    // Production files in an analyzed language, as packages count them
    let code_files = (0..files.len())
        .filter(|&file| production[file] && file_languages[file].is_analyzed())
        .count() as u64;
    let islands = islands::islands(
        &dirs.dirs.parent,
        &table.dir,
        &production,
        &packages::monorepo_dirs(&found.packages, &dirs.dirs.parent, code_files),
    );
    dirs.dirs.island.clone_from(&islands.of_dir);
    let layers = islands::layers(&graph, &islands, &table.dir);
    let links = islands::links(
        &islands,
        &layers,
        &table.dir,
        &table.barrel,
        import_dirs.iter().copied(),
    );
    let analyzed: Vec<bool> = files
        .iter()
        .map(|file| file.language.is_analyzed())
        .collect();
    let layout = layout::layout(&layout::Input {
        parents: &dirs.dirs.parent,
        dir_paths: &dir_paths,
        dir_islands: &dirs.dirs.island,
        island_dirs: &islands.dirs,
        file_dirs: &table.dir,
        scopes: &table.scope,
        analyzed: &analyzed,
    });
    let mut result = AnalysisResult {
        format_version: FORMAT_VERSION,
        analyzer_version: ANALYZER_VERSION.to_owned(),
        repo,
        sha,
        dirs: dirs.dirs,
        languages,
        files: table,
        symbols,
        edges: table_edges,
        roles: Roles {
            entries,
            foundations,
            conductors,
        },
        islands: Islands {
            dir: islands.dirs,
            layer: layers,
        },
        links,
        cycles: cycles::cycles(&graph),
        workspaces: found.workspaces,
        packages: found.packages,
        package_groups: found.groups,
        externals: found.externals,
        layout,
        tour: Tour::default(),
        stats: Stats {
            ignored,
            imports_total: report.exact + report.likely + report.external + report.unresolved,
            imports_resolved: report.exact + report.likely,
            imports_external: report.external,
        },
    };
    result.tour = crate::tour::of_result(&result);
    let report = Report {
        imports: report,
        barrels: barrel_report,
        graph,
        roles: roles_report,
    };
    (result, report)
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
                island: Vec::new(),
            },
            by_path: HashMap::from([(String::new(), 0)]),
        }
    }

    /// The row of the folder at `path` (`""` for the root), added with its
    /// missing ancestors.
    fn index(&mut self, path: &str) -> u32 {
        // Up to the nearest known ancestor, then down: a loop, not a recursion,
        // for paths thousands of folders deep.
        let mut missing = Vec::new();
        let mut current = path;
        let mut row = loop {
            if let Some(&row) = self.by_path.get(current) {
                break row;
            }
            missing.push(current);
            current = split_path(current).0;
        };
        for &path in missing.iter().rev() {
            let parent = row;
            row = index(self.dirs.parent.len());
            self.dirs.parent.push(Some(parent));
            self.dirs.name.push(split_path(path).1.to_owned());
            self.by_path.insert(path.to_owned(), row);
        }
        row
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
    fn the_deepest_kept_file_is_analyzed() {
        let path = format!("{}a.ts", "d/".repeat(crate::files::MAX_DEPTH));
        assert_eq!(
            crate::files::classify_path(&path),
            crate::files::Verdict::Keep { generated: false }
        );
        let result = result(vec![file(&path, Some("export const a = 1\n"))]);
        assert_eq!(result.validate(), Ok(()));
        assert_eq!(result.dirs.name.len(), crate::files::MAX_DEPTH + 1);
        assert_eq!(result.files.name, ["a.ts"]);
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
                // Root tooling that the code does not import
                Scope::Build,
                Scope::Build
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
