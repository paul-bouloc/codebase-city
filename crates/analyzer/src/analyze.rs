//! Assembling the analysis result from the files of a repository.

use std::collections::HashMap;

use model::{AnalysisResult, Dirs, Edges, FORMAT_VERSION, Files, Ignored, Repo, Stats, Symbols};
use rayon::prelude::*;

use crate::files::{SourceFile, split_path};
use crate::lang::{self, Parsed};
use crate::saturating_u32 as index;

/// Version of the algorithms. Bumped whenever a change would give another
/// result for the same commit, so stored results are recomputed.
pub const ANALYZER_VERSION: &str = "0.1.0";

/// Analyzes the files of one commit. The result does not depend on the
/// order of `files`: they are sorted by path first.
///
/// Imports are not resolved yet: the result has no edges.
pub fn analyze(
    repo: Repo,
    sha: String,
    mut files: Vec<SourceFile>,
    ignored: Ignored,
) -> AnalysisResult {
    files.sort_by(|a, b| a.path.cmp(&b.path));
    // `collect` keeps the order of the files, whatever the scheduling. Each
    // content is freed once parsed: nothing after needs it yet
    let parsed: Vec<Option<Parsed>> = files
        .par_iter_mut()
        .map(|file| {
            let content = file.content.take()?;
            lang::parse(&file.path, file.language, &content)
        })
        .collect();

    let mut dirs = DirTree::new();
    let mut languages: Vec<String> = Vec::new();
    let mut table = Files::default();
    let mut symbols = Symbols::default();
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
            }
            None => {
                table.complexity.push(None);
                table.header.push(None);
            }
        }
    }

    AnalysisResult {
        format_version: FORMAT_VERSION,
        analyzer_version: ANALYZER_VERSION.to_owned(),
        repo,
        sha,
        dirs: dirs.dirs,
        languages,
        files: table,
        symbols,
        edges: Edges::default(),
        stats: Stats {
            ignored,
            imports_total: 0,
            imports_resolved: 0,
        },
    }
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
