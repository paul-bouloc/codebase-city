//! Consistency checks on an analysis result, run before it is stored.
//!
//! The web app runs the same checks when it decodes a result
//! (`web/src/data/decode-result.ts`); the two lists must stay in step.

use crate::result::{AnalysisResult, FORMAT_VERSION};

/// Why a result is inconsistent. Columns are named as in the JSON.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum InvalidResult {
    #[error("unsupported format version {0}, expected {FORMAT_VERSION}")]
    FormatVersion(u32),
    #[error("column {column} has {actual} rows, expected {expected}")]
    ColumnLength {
        column: &'static str,
        expected: usize,
        actual: usize,
    },
    #[error("{column}[{row}] points to row {index}, but the table has {len} rows")]
    IndexOutOfBounds {
        column: &'static str,
        row: usize,
        index: u32,
        len: usize,
    },
    #[error("the first folder must be the root: no parent and an empty name")]
    Root,
    #[error("dirs.parent[{row}] must point to an earlier folder")]
    ParentOrder { row: usize },
    #[error("{column}[{row}] is not a valid name")]
    Name { column: &'static str, row: usize },
    #[error("symbols.name[{row}] is empty")]
    SymbolName { row: usize },
    #[error("symbols.line[{row}] must be 1 or more")]
    SymbolLine { row: usize },
    #[error("symbols[{row}] must come after the previous symbol, by file then line")]
    SymbolOrder { row: usize },
    #[error("edges[{row}] must have exactly one target, in to or toDir")]
    EdgeTarget { row: usize },
    #[error("edges[{row}] points to the file it comes from")]
    EdgeLoop { row: usize },
    #[error("edges[{row}] must come after the previous edge, by file then target")]
    EdgeOrder { row: usize },
    #[error("{table}[{row}] must have exactly one target, in file or dir")]
    RowTarget { table: &'static str, row: usize },
    #[error("roles.entries.reasons[{row}] is empty")]
    EntryReasons { row: usize },
    #[error(
        "stats.importsResolved and stats.importsExternal add up to more than stats.importsTotal"
    )]
    ImportCounts,
}

impl AnalysisResult {
    /// Checks everything the types cannot say: matching column lengths,
    /// indexes in bounds, a well-formed folder tree and valid names.
    pub fn validate(&self) -> Result<(), InvalidResult> {
        if self.format_version != FORMAT_VERSION {
            return Err(InvalidResult::FormatVersion(self.format_version));
        }

        let dirs = &self.dirs;
        let dir_count = dirs.parent.len();
        same_length("dirs.name", dir_count, dirs.name.len())?;
        match (dirs.parent.first(), dirs.name.first()) {
            (Some(None), Some(name)) if name.is_empty() => {}
            _ => return Err(InvalidResult::Root),
        }
        for (row, parent) in dirs.parent.iter().enumerate().skip(1) {
            // Parents come first, so the tree has one root and no loop
            if !parent.is_some_and(|parent| index_below(parent, row)) {
                return Err(InvalidResult::ParentOrder { row });
            }
        }
        valid_names("dirs.name", dirs.name.iter().skip(1), 1)?;

        let files = &self.files;
        let file_count = files.dir.len();
        same_length("files.name", file_count, files.name.len())?;
        same_length("files.language", file_count, files.language.len())?;
        same_length("files.lines", file_count, files.lines.len())?;
        same_length("files.complexity", file_count, files.complexity.len())?;
        same_length("files.generated", file_count, files.generated.len())?;
        same_length("files.header", file_count, files.header.len())?;
        same_length("files.scope", file_count, files.scope.len())?;
        same_length("files.barrel", file_count, files.barrel.len())?;
        same_length("files.dependents", file_count, files.dependents.len())?;
        same_length("files.dependencies", file_count, files.dependencies.len())?;
        in_bounds("files.dir", &files.dir, dir_count)?;
        in_bounds("files.language", &files.language, self.languages.len())?;
        valid_names("files.name", files.name.iter(), 0)?;

        let symbols = &self.symbols;
        let symbol_count = symbols.file.len();
        same_length("symbols.name", symbol_count, symbols.name.len())?;
        same_length("symbols.kind", symbol_count, symbols.kind.len())?;
        same_length("symbols.line", symbol_count, symbols.line.len())?;
        in_bounds("symbols.file", &symbols.file, file_count)?;
        if let Some(row) = symbols.name.iter().position(String::is_empty) {
            return Err(InvalidResult::SymbolName { row });
        }
        if let Some(row) = symbols.line.iter().position(|&line| line == 0) {
            return Err(InvalidResult::SymbolLine { row });
        }
        let positions: Vec<_> = symbols.file.iter().zip(&symbols.line).collect();
        if let Some(row) = positions.windows(2).position(|pair| pair[0] > pair[1]) {
            return Err(InvalidResult::SymbolOrder { row: row + 1 });
        }

        let edges = &self.edges;
        let edge_count = edges.from.len();
        same_length("edges.to", edge_count, edges.to.len())?;
        same_length("edges.toDir", edge_count, edges.to_dir.len())?;
        same_length("edges.kind", edge_count, edges.kind.len())?;
        same_length("edges.confidence", edge_count, edges.confidence.len())?;
        in_bounds("edges.from", &edges.from, file_count)?;
        in_bounds_or_null("edges.to", &edges.to, file_count)?;
        in_bounds_or_null("edges.toDir", &edges.to_dir, dir_count)?;
        let mut previous = None;
        for row in 0..edge_count {
            // File targets sort before folder targets
            let target = match (edges.to[row], edges.to_dir[row]) {
                (Some(file), None) => (false, file),
                (None, Some(dir)) => (true, dir),
                _ => return Err(InvalidResult::EdgeTarget { row }),
            };
            if edges.to[row] == Some(edges.from[row]) {
                return Err(InvalidResult::EdgeLoop { row });
            }
            let key = (edges.from[row], target);
            // Strictly increasing, so a target appears once per file
            if previous.is_some_and(|previous| previous >= key) {
                return Err(InvalidResult::EdgeOrder { row });
            }
            previous = Some(key);
        }

        let entries = &self.roles.entries;
        let entry_count = entries.file.len();
        same_length("roles.entries.dir", entry_count, entries.dir.len())?;
        same_length("roles.entries.reasons", entry_count, entries.reasons.len())?;
        same_length("roles.entries.command", entry_count, entries.command.len())?;
        targets(
            ["roles.entries", "roles.entries.file", "roles.entries.dir"],
            (&entries.file, &entries.dir),
            (file_count, dir_count),
        )?;
        if let Some(row) = entries.reasons.iter().position(Vec::is_empty) {
            return Err(InvalidResult::EntryReasons { row });
        }
        let foundations = &self.roles.foundations;
        same_length(
            "roles.foundations.dir",
            foundations.file.len(),
            foundations.dir.len(),
        )?;
        same_length(
            "roles.foundations.count",
            foundations.file.len(),
            foundations.count.len(),
        )?;
        targets(
            [
                "roles.foundations",
                "roles.foundations.file",
                "roles.foundations.dir",
            ],
            (&foundations.file, &foundations.dir),
            (file_count, dir_count),
        )?;
        let conductors = &self.roles.conductors;
        same_length(
            "roles.conductors.dir",
            conductors.file.len(),
            conductors.dir.len(),
        )?;
        same_length(
            "roles.conductors.count",
            conductors.file.len(),
            conductors.count.len(),
        )?;
        targets(
            [
                "roles.conductors",
                "roles.conductors.file",
                "roles.conductors.dir",
            ],
            (&conductors.file, &conductors.dir),
            (file_count, dir_count),
        )?;

        let stats = &self.stats;
        if u64::from(stats.imports_resolved) + u64::from(stats.imports_external)
            > u64::from(stats.imports_total)
        {
            return Err(InvalidResult::ImportCounts);
        }
        Ok(())
    }
}

/// Rows that each point to one file or one folder, in bounds. `names` are
/// the table and its two columns.
fn targets(
    names: [&'static str; 3],
    (files, dirs): (&[Option<u32>], &[Option<u32>]),
    (file_count, dir_count): (usize, usize),
) -> Result<(), InvalidResult> {
    let [table, file_column, dir_column] = names;
    in_bounds_or_null(file_column, files, file_count)?;
    in_bounds_or_null(dir_column, dirs, dir_count)?;
    match files
        .iter()
        .zip(dirs)
        .position(|(file, dir)| file.is_some() == dir.is_some())
    {
        None => Ok(()),
        Some(row) => Err(InvalidResult::RowTarget { table, row }),
    }
}

fn same_length(column: &'static str, expected: usize, actual: usize) -> Result<(), InvalidResult> {
    if actual == expected {
        Ok(())
    } else {
        Err(InvalidResult::ColumnLength {
            column,
            expected,
            actual,
        })
    }
}

fn index_below(index: u32, len: usize) -> bool {
    usize::try_from(index).is_ok_and(|index| index < len)
}

fn in_bounds(column: &'static str, indexes: &[u32], len: usize) -> Result<(), InvalidResult> {
    match indexes.iter().position(|&index| !index_below(index, len)) {
        None => Ok(()),
        Some(row) => Err(InvalidResult::IndexOutOfBounds {
            column,
            row,
            index: indexes[row],
            len,
        }),
    }
}

fn in_bounds_or_null(
    column: &'static str,
    indexes: &[Option<u32>],
    len: usize,
) -> Result<(), InvalidResult> {
    match indexes
        .iter()
        .position(|index| index.is_some_and(|index| !index_below(index, len)))
    {
        None => Ok(()),
        Some(row) => Err(InvalidResult::IndexOutOfBounds {
            column,
            row,
            index: indexes[row].unwrap_or_default(),
            len,
        }),
    }
}

/// A path segment: not empty, no slash, not `.` or `..`.
fn valid_names<'a>(
    column: &'static str,
    names: impl Iterator<Item = &'a String>,
    first_row: usize,
) -> Result<(), InvalidResult> {
    for (offset, name) in names.enumerate() {
        if name.is_empty() || name.contains('/') || name == "." || name == ".." {
            return Err(InvalidResult::Name {
                column,
                row: first_row + offset,
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::result::{
        Confidence, Dirs, EdgeKind, Edges, Entries, EntryReason, Files, Ranked, Repo, Roles, Scope,
        Stats, SymbolKind, Symbols,
    };

    /// Two folders, two files, an import between them and two of folders,
    /// an entry point, a foundation and a conductor.
    fn result() -> AnalysisResult {
        AnalysisResult {
            format_version: FORMAT_VERSION,
            analyzer_version: "0.1.0".to_owned(),
            repo: Repo {
                owner: "acme".to_owned(),
                name: "app".to_owned(),
            },
            sha: "0".repeat(40),
            dirs: Dirs {
                parent: vec![None, Some(0)],
                name: vec![String::new(), "src".to_owned()],
            },
            languages: vec!["TypeScript".to_owned()],
            files: Files {
                dir: vec![1, 1],
                name: vec!["main.ts".to_owned(), "util.ts".to_owned()],
                language: vec![0, 0],
                lines: vec![40, 12],
                complexity: vec![Some(6), Some(2)],
                generated: vec![false, false],
                header: vec![Some("// Starts the app.".to_owned()), None],
                scope: vec![Scope::Source, Scope::Source],
                barrel: vec![false, false],
                dependents: vec![Some(0), Some(1)],
                dependencies: vec![Some(1), Some(0)],
            },
            symbols: Symbols {
                file: vec![0, 1, 1],
                name: vec!["main".to_owned(), "clamp".to_owned(), "Range".to_owned()],
                kind: vec![SymbolKind::Function, SymbolKind::Function, SymbolKind::Type],
                line: vec![3, 1, 8],
            },
            edges: Edges {
                from: vec![0, 0, 1],
                to: vec![Some(1), None, None],
                to_dir: vec![None, Some(0), Some(1)],
                kind: vec![EdgeKind::Import, EdgeKind::Import, EdgeKind::Type],
                confidence: vec![Confidence::Exact, Confidence::Exact, Confidence::Likely],
            },
            roles: Roles {
                entries: Entries {
                    file: vec![Some(0)],
                    dir: vec![None],
                    reasons: vec![vec![
                        EntryReason::PackageMain,
                        EntryReason::ConventionalName,
                    ]],
                    command: vec![None],
                },
                foundations: Ranked {
                    file: vec![Some(1)],
                    dir: vec![None],
                    count: vec![1],
                },
                conductors: Ranked {
                    file: vec![None],
                    dir: vec![Some(1)],
                    count: vec![1],
                },
            },
            stats: Stats {
                imports_total: 6,
                imports_resolved: 3,
                imports_external: 2,
                ..Stats::default()
            },
        }
    }

    fn invalid(change: impl FnOnce(&mut AnalysisResult)) -> InvalidResult {
        let mut result = result();
        change(&mut result);
        result.validate().unwrap_err()
    }

    #[test]
    fn a_consistent_result_is_valid() {
        assert_eq!(result().validate(), Ok(()));
    }

    #[test]
    fn another_format_version_is_rejected() {
        assert_eq!(
            invalid(|r| r.format_version = 1),
            InvalidResult::FormatVersion(1)
        );
    }

    #[test]
    fn columns_of_a_table_must_have_the_same_length() {
        assert_eq!(
            invalid(|r| r.files.lines.push(1)),
            InvalidResult::ColumnLength {
                column: "files.lines",
                expected: 2,
                actual: 3,
            }
        );
        assert_eq!(
            invalid(|r| r.dirs.name.truncate(1)),
            InvalidResult::ColumnLength {
                column: "dirs.name",
                expected: 2,
                actual: 1,
            }
        );
        assert_eq!(
            invalid(|r| r.files.header.truncate(1)),
            InvalidResult::ColumnLength {
                column: "files.header",
                expected: 2,
                actual: 1,
            }
        );
        assert_eq!(
            invalid(|r| r.files.scope.truncate(1)),
            InvalidResult::ColumnLength {
                column: "files.scope",
                expected: 2,
                actual: 1,
            }
        );
        assert_eq!(
            invalid(|r| r.files.dependents.push(None)),
            InvalidResult::ColumnLength {
                column: "files.dependents",
                expected: 2,
                actual: 3,
            }
        );
        assert_eq!(
            invalid(|r| r.files.barrel.clear()),
            InvalidResult::ColumnLength {
                column: "files.barrel",
                expected: 2,
                actual: 0,
            }
        );
        assert_eq!(
            invalid(|r| r.roles.entries.command.clear()),
            InvalidResult::ColumnLength {
                column: "roles.entries.command",
                expected: 1,
                actual: 0,
            }
        );
        assert_eq!(
            invalid(|r| r.roles.conductors.count.push(2)),
            InvalidResult::ColumnLength {
                column: "roles.conductors.count",
                expected: 1,
                actual: 2,
            }
        );
        assert_eq!(
            invalid(|r| r.symbols.kind.truncate(2)),
            InvalidResult::ColumnLength {
                column: "symbols.kind",
                expected: 3,
                actual: 2,
            }
        );
        assert_eq!(
            invalid(|r| r.edges.confidence.clear()),
            InvalidResult::ColumnLength {
                column: "edges.confidence",
                expected: 3,
                actual: 0,
            }
        );
        assert_eq!(
            invalid(|r| r.edges.to_dir.truncate(2)),
            InvalidResult::ColumnLength {
                column: "edges.toDir",
                expected: 3,
                actual: 2,
            }
        );
    }

    #[test]
    fn indexes_must_point_to_an_existing_row() {
        assert_eq!(
            invalid(|r| r.files.dir[1] = 2),
            InvalidResult::IndexOutOfBounds {
                column: "files.dir",
                row: 1,
                index: 2,
                len: 2,
            }
        );
        assert_eq!(
            invalid(|r| r.files.language[0] = 1),
            InvalidResult::IndexOutOfBounds {
                column: "files.language",
                row: 0,
                index: 1,
                len: 1,
            }
        );
        assert_eq!(
            invalid(|r| r.edges.to[0] = Some(u32::MAX)),
            InvalidResult::IndexOutOfBounds {
                column: "edges.to",
                row: 0,
                index: u32::MAX,
                len: 2,
            }
        );
        assert_eq!(
            invalid(|r| r.edges.to_dir[2] = Some(2)),
            InvalidResult::IndexOutOfBounds {
                column: "edges.toDir",
                row: 2,
                index: 2,
                len: 2,
            }
        );
    }

    #[test]
    fn the_first_folder_must_be_the_root() {
        assert_eq!(invalid(|r| r.dirs = Dirs::default()), InvalidResult::Root);
        assert_eq!(invalid(|r| r.dirs.parent[0] = Some(0)), InvalidResult::Root);
        assert_eq!(
            invalid(|r| r.dirs.name[0] = "root".to_owned()),
            InvalidResult::Root
        );
    }

    #[test]
    fn a_folder_must_come_after_its_parent() {
        assert_eq!(
            invalid(|r| r.dirs.parent[1] = None),
            InvalidResult::ParentOrder { row: 1 }
        );
        assert_eq!(
            invalid(|r| r.dirs.parent[1] = Some(1)),
            InvalidResult::ParentOrder { row: 1 }
        );
    }

    #[test]
    fn names_are_single_path_segments() {
        for name in ["", "a/b", ".", ".."] {
            assert_eq!(
                invalid(|r| r.files.name[1] = name.to_owned()),
                InvalidResult::Name {
                    column: "files.name",
                    row: 1,
                }
            );
        }
        assert_eq!(
            invalid(|r| r.dirs.name[1] = String::new()),
            InvalidResult::Name {
                column: "dirs.name",
                row: 1,
            }
        );
    }

    #[test]
    fn symbols_point_to_a_file() {
        assert_eq!(
            invalid(|r| r.symbols.file[2] = 2),
            InvalidResult::IndexOutOfBounds {
                column: "symbols.file",
                row: 2,
                index: 2,
                len: 2,
            }
        );
    }

    #[test]
    fn symbols_have_a_name_and_a_line() {
        assert_eq!(
            invalid(|r| r.symbols.name[1] = String::new()),
            InvalidResult::SymbolName { row: 1 }
        );
        assert_eq!(
            invalid(|r| r.symbols.line[0] = 0),
            InvalidResult::SymbolLine { row: 0 }
        );
    }

    #[test]
    fn symbols_are_sorted_by_file_then_line() {
        assert_eq!(
            invalid(|r| r.symbols.line[1] = 9),
            InvalidResult::SymbolOrder { row: 2 }
        );
        assert_eq!(
            invalid(|r| r.symbols.file.swap(0, 1)),
            InvalidResult::SymbolOrder { row: 1 }
        );
    }

    #[test]
    fn an_edge_has_one_target() {
        assert_eq!(
            invalid(|r| r.edges.to_dir[0] = Some(1)),
            InvalidResult::EdgeTarget { row: 0 }
        );
        assert_eq!(
            invalid(|r| r.edges.to_dir[1] = None),
            InvalidResult::EdgeTarget { row: 1 }
        );
    }

    #[test]
    fn an_edge_does_not_loop_on_its_file() {
        assert_eq!(
            invalid(|r| r.edges.to[0] = Some(0)),
            InvalidResult::EdgeLoop { row: 0 }
        );
    }

    #[test]
    fn edges_are_sorted_and_unique() {
        // A folder target before a file target of the same file
        assert_eq!(
            invalid(|r| {
                r.edges.to.swap(0, 1);
                r.edges.to_dir.swap(0, 1);
            }),
            InvalidResult::EdgeOrder { row: 1 }
        );
        assert_eq!(
            invalid(|r| {
                r.edges.from[0] = 1;
                r.edges.to[0] = Some(0);
            }),
            InvalidResult::EdgeOrder { row: 1 }
        );
        // The same folder twice from the same file
        assert_eq!(
            invalid(|r| {
                r.edges.from[2] = 0;
                r.edges.to_dir[2] = Some(0);
            }),
            InvalidResult::EdgeOrder { row: 2 }
        );
    }

    #[test]
    fn roles_point_to_one_existing_file_or_folder() {
        assert_eq!(
            invalid(|r| r.roles.entries.file[0] = Some(2)),
            InvalidResult::IndexOutOfBounds {
                column: "roles.entries.file",
                row: 0,
                index: 2,
                len: 2,
            }
        );
        assert_eq!(
            invalid(|r| r.roles.conductors.dir[0] = Some(5)),
            InvalidResult::IndexOutOfBounds {
                column: "roles.conductors.dir",
                row: 0,
                index: 5,
                len: 2,
            }
        );
        assert_eq!(
            invalid(|r| r.roles.foundations.dir[0] = Some(1)),
            InvalidResult::RowTarget {
                table: "roles.foundations",
                row: 0,
            }
        );
        assert_eq!(
            invalid(|r| r.roles.entries.file[0] = None),
            InvalidResult::RowTarget {
                table: "roles.entries",
                row: 0,
            }
        );
    }

    #[test]
    fn an_entry_point_has_a_reason() {
        assert_eq!(
            invalid(|r| r.roles.entries.reasons[0].clear()),
            InvalidResult::EntryReasons { row: 0 }
        );
    }

    #[test]
    fn counted_imports_cannot_outnumber_the_total() {
        assert_eq!(
            invalid(|r| r.stats.imports_resolved = 5),
            InvalidResult::ImportCounts
        );
        assert_eq!(
            invalid(|r| r.stats.imports_external = u32::MAX),
            InvalidResult::ImportCounts
        );
    }
}
