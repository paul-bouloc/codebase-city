//! The packages of a monorepo: the folders its workspace declares, and the
//! projects of a language nothing declares; what each one is (an app or a
//! library), the framework it is built with and where it starts, the
//! prefixes that group them; and, for every repository, the dependencies
//! the production code imports.

mod externals;
mod framework;
mod groups;
mod manifest;
mod workspace;

use std::collections::{BTreeSet, HashMap, HashSet};

use model::{Externals, PackageGroups, PackageKind, Packages, Workspace};

use crate::files::{Language, split_path};
use crate::graph::entries::package_start;
use crate::lang::Import;
use crate::resolve::Outcome;
use crate::saturating_u32 as index;
use externals::Declared;

/// What the packages are found from, by row in the result.
pub(crate) struct Input<'a> {
    /// The name of the repository (`twenty` for `twentyhq/twenty`).
    pub repo: &'a str,
    /// Paths of the files, sorted, and of the folders (`""` for the root).
    pub paths: &'a [&'a str],
    pub dir_paths: &'a [&'a str],
    /// The parent of each folder, each folder after its parent.
    pub parents: &'a [Option<u32>],
    pub file_dirs: &'a [u32],
    pub languages: &'a [Language],
    /// The manifests that kept their content, by path.
    pub manifests: &'a [(&'a str, &'a [u8])],
    pub production: &'a [bool],
    /// Files that start a program (Go `func main`, Python `__main__` block).
    pub mains: &'a [bool],
    pub imports: &'a [Vec<Import>],
    pub outcomes: &'a [Vec<Outcome>],
    /// Imports between files: importing file, folder of the imported file
    /// or package.
    pub links: &'a [(u32, u32)],
}

/// The sections of the result the packages fill.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Found {
    pub workspaces: Vec<Workspace>,
    pub packages: Packages,
    pub groups: PackageGroups,
    pub externals: Externals,
}

pub(crate) fn find(input: &Input<'_>) -> Found {
    let by_path: HashMap<&str, u32> = input
        .paths
        .iter()
        .enumerate()
        .map(|(row, &path)| (path, index(row)))
        .collect();
    let manifests = Manifests::read(input, &by_path);
    let mut found = Found::default();
    let declarations = workspace::declarations(input.manifests);
    found.workspaces = declarations
        .iter()
        .filter_map(|declaration| {
            Some(Workspace {
                kind: declaration.kind,
                manifest: *by_path.get(declaration.manifest.as_str())?,
            })
        })
        .collect();
    let dirs = package_dirs(input, &declarations, &manifests);
    let package_of_dir = package_of_dirs(input.parents, &dirs);
    let package_of_file: Vec<Option<u32>> = input
        .file_dirs
        .iter()
        .map(|&dir| package_of_dir[dir as usize])
        .collect();
    let imports = package_imports(input, &package_of_dir, &package_of_file);
    let imported: HashSet<usize> = imports.iter().map(|&(_, to)| to).collect();
    found.packages = packages(
        input,
        &manifests,
        &dirs,
        &package_of_file,
        &imported,
        &by_path,
    );
    found.groups = group(input, &manifests, &mut found.packages, &imports);
    found.externals = externals(input, &manifests, &package_of_file);
    found
}

/// The package of each folder: a folder inherits its parent's. Parents come
/// before their children.
pub(crate) fn package_of_dirs(parents: &[Option<u32>], package_dirs: &[u32]) -> Vec<Option<u32>> {
    let mut package_of_dir = vec![None; parents.len()];
    for (row, &dir) in package_dirs.iter().enumerate() {
        package_of_dir[dir as usize] = Some(index(row));
    }
    for dir in 1..parents.len() {
        if package_of_dir[dir].is_none() {
            package_of_dir[dir] = parents[dir].and_then(|parent| package_of_dir[parent as usize]);
        }
    }
    package_of_dir
}

/// The packages with production code a workspace declares to make a
/// monorepo: a single one is a repository whose code sits in a subfolder.
const MONOREPO_PACKAGES: usize = 2;

/// The folders of the packages that make islands when the repository is a
/// monorepo, that is when its workspace declares at least two packages
/// with production code; none otherwise. vscode's workspace declares only
/// tooling and tests: it is not a monorepo. The root package has no island
/// of its own, and a package inside another one stays on that one's
/// island.
///
/// The packages must also hold half of the repository's code, `code` its
/// production files in an analyzed language: vscode's workspace declares
/// its extensions, a quarter of its code, while the editor itself lies in
/// no package.
pub(crate) fn monorepo_dirs(packages: &Packages, parents: &[Option<u32>], code: u64) -> Vec<u32> {
    let with_code = packages.code_files.iter().filter(|&&files| files > 0);
    let held: u64 = packages
        .code_files
        .iter()
        .map(|&files| u64::from(files))
        .sum();
    if with_code.count() < MONOREPO_PACKAGES || held * 2 < code {
        return Vec::new();
    }
    let package: HashSet<u32> = packages
        .dir
        .iter()
        .copied()
        .filter(|&dir| dir != 0)
        .collect();
    packages
        .dir
        .iter()
        .copied()
        .filter(|&dir| {
            let mut current = parents[dir as usize];
            while let Some(parent) = current {
                if package.contains(&parent) {
                    return false;
                }
                current = parents[parent as usize];
            }
            dir != 0
        })
        .collect()
}

/// The folders a declaration matches that hold an analyzed file and a
/// manifest of that declaration, in folder order; the root first when a
/// declaration lists it. A folder inside another package is a package of
/// its own only with production code: tests and fixtures declared inside
/// a package (an app per test of sveltejs/kit) are not. A folder two
/// declarations match is one package.
fn package_dirs(
    input: &Input<'_>,
    declarations: &[workspace::Declaration],
    manifests: &Manifests<'_>,
) -> Vec<u32> {
    let count = input.dir_paths.len();
    let mut has_code = vec![false; count];
    let mut has_production = vec![false; count];
    for (file, (&dir, language)) in input.file_dirs.iter().zip(input.languages).enumerate() {
        has_code[dir as usize] |= language.is_analyzed();
        has_production[dir as usize] |= language.is_analyzed() && input.production[file];
    }
    // Children come after their parent: going backwards adds each subtree
    for dir in (1..count).rev() {
        if let Some(parent) = input.parents[dir] {
            has_code[parent as usize] |= has_code[dir];
            has_production[parent as usize] |= has_production[dir];
        }
    }
    let declared = |dir: usize, path: bool| {
        let own = manifests.own.get(&index(dir));
        declarations.iter().any(|declaration| {
            let listed = if path {
                declaration.matches(input.dir_paths[dir])
            } else {
                declaration.root
            };
            listed
                && declaration
                    .members()
                    .iter()
                    .any(|name| own.is_some_and(|own| own.contains_key(name)))
        })
    };
    let mut dirs = Vec::new();
    if count > 0 && has_code[0] && declared(0, false) {
        dirs.push(0);
    }
    // Inside a package other than the root
    let mut inside = vec![false; count];
    for dir in 1..count {
        let parent = input.parents[dir].is_some_and(|parent| inside[parent as usize]);
        let code = if parent {
            has_production[dir]
        } else {
            has_code[dir]
        };
        let package = code && declared(dir, true);
        inside[dir] = parent || package;
        if package {
            dirs.push(index(dir));
        }
    }
    with_implicit(input, declarations, manifests, dirs, &has_production)
}

/// The declared packages and the implicit ones: in a language no
/// declaration covers, a folder with a manifest of that language whose
/// own production code (outside deeper packages) holds a file of the
/// language, the root included. memos keeps a Go server at its root and a
/// Vite app in `web` without declaring them. A root `pyproject.toml` that
/// only configures tools makes no package: its folder holds no Python of
/// its own. Implicit packages count only when the repository has at least
/// two packages in all: a repository of a single project has none.
fn with_implicit(
    input: &Input<'_>,
    declarations: &[workspace::Declaration],
    manifests: &Manifests<'_>,
    declared: Vec<u32>,
    has_production: &[bool],
) -> Vec<u32> {
    let undeclared = workspace::undeclared(declarations);
    let mut implicit: HashMap<u32, Vec<workspace::Ecosystem>> = HashMap::new();
    for (&dir, own) in &manifests.own {
        let ecosystems: Vec<workspace::Ecosystem> = undeclared
            .iter()
            .copied()
            .filter(|ecosystem| {
                ecosystem
                    .manifests()
                    .iter()
                    .any(|name| own.contains_key(name))
            })
            .collect();
        if has_production[dir as usize] && !ecosystems.is_empty() {
            implicit.insert(dir, ecosystems);
        }
    }
    let mut all: Vec<u32> = declared
        .iter()
        .copied()
        .chain(implicit.keys().copied())
        .collect();
    all.sort_unstable();
    all.dedup();
    // Leaving out a folder hands its files to the package around it, which
    // may then hold code of its own: repeat until nothing changes
    loop {
        let package_of_dir = package_of_dirs(input.parents, &all);
        let mut holds = vec![false; all.len()];
        for (file, (&dir, &language)) in input.file_dirs.iter().zip(input.languages).enumerate() {
            let Some(row) = package_of_dir[dir as usize] else {
                continue;
            };
            let row = row as usize;
            holds[row] |= input.production[file]
                && implicit
                    .get(&all[row])
                    .is_some_and(|ecosystems| ecosystems.iter().any(|e| e.holds(language)));
        }
        let kept: Vec<u32> = all
            .iter()
            .zip(&holds)
            .filter(|&(dir, &holds)| holds || declared.contains(dir))
            .map(|(&dir, _)| dir)
            .collect();
        if kept.len() == all.len() {
            break;
        }
        all = kept;
    }
    if all.len() < MONOREPO_PACKAGES {
        declared
    } else {
        all
    }
}

/// How a Go program ranks as its package's entry, the lowest first, as Go
/// lays out commands: `main.go` in the package's folder, then
/// `cmd/<module>/main.go` (grafana's `pkg/cmd/grafana/main.go`), then any
/// `main.go`, then any other program (a generator such as `kinds/gen.go`
/// comes last); the shallowest, then the first by path, on a tie.
fn go_program_rank<'p>(package: &str, file: &'p str, module: &str) -> (u8, usize, &'p str) {
    let inside = if package.is_empty() {
        file
    } else {
        file.strip_prefix(package)
            .map_or(file, |rest| rest.trim_start_matches('/'))
    };
    let named = inside.rsplit('/').next() == Some("main.go");
    let command = format!("cmd/{module}/main.go");
    let rank = if inside == "main.go" {
        0
    } else if named && (inside == command || inside.ends_with(&format!("/{command}"))) {
        1
    } else if named {
        2
    } else {
        3
    };
    (rank, inside.matches('/').count(), file)
}

fn packages(
    input: &Input<'_>,
    manifests: &Manifests<'_>,
    dirs: &[u32],
    package_of_file: &[Option<u32>],
    imported: &HashSet<usize>,
    by_path: &HashMap<&str, u32>,
) -> Packages {
    let mut code: Vec<Vec<(&str, u32)>> = vec![Vec::new(); dirs.len()];
    for (file, package) in package_of_file.iter().enumerate() {
        if let Some(package) = package
            && input.production[file]
            && input.languages[file].is_analyzed()
        {
            code[*package as usize].push((input.paths[file], index(file)));
        }
    }
    let production = |file: u32| input.production[file as usize];
    let dir_by_path: HashMap<&str, u32> = input
        .dir_paths
        .iter()
        .enumerate()
        .map(|(row, &path)| (path, index(row)))
        .collect();
    let no_python = BTreeSet::new();
    let no_manifests = HashMap::new();
    let mut packages = Packages::default();
    for (row, &dir) in dirs.iter().enumerate() {
        let path = input.dir_paths[dir as usize];
        let npm = manifests.npm.get(&dir);
        let start = manifests
            .own
            .get(&dir)
            .and_then(|own| own.get("package.json"))
            .and_then(|content| package_start(path, content, by_path, &production));
        let module = manifests
            .named
            .get(&dir)
            .and_then(|(name, _)| name.as_deref())
            .map_or(split_path(path).1, |name| {
                name.rsplit('/').next().unwrap_or(name)
            });
        let go_main = code[row]
            .iter()
            .filter(|&&(_, file)| {
                input.languages[file as usize] == Language::Go && input.mains[file as usize]
            })
            .min_by_key(|&&(file_path, _)| go_program_rank(path, file_path, module))
            .map(|&(_, file)| file);
        let read = framework::read(&framework::Package {
            dir: path,
            npm: npm.map(|(_, npm)| npm),
            python: manifests.python.get(&dir).unwrap_or(&no_python),
            own: manifests.own.get(&dir).unwrap_or(&no_manifests),
            code: &code[row],
            start,
            go_main,
            program: npm.is_some_and(|(_, npm)| npm.bin) || manifests.commands.contains(&dir),
            imported: imported.contains(&row),
        });
        let folder = split_path(path).1;
        let named = manifests.named.get(&dir);
        let name = npm
            .and_then(|(_, npm)| npm.name.clone())
            .or_else(|| named.and_then(|(name, _)| name.clone()))
            .unwrap_or_else(|| folder.to_owned());
        packages.dir.push(dir);
        packages.name.push(name);
        packages.kind.push(if read.app {
            PackageKind::App
        } else {
            PackageKind::Library
        });
        packages.framework.push(read.framework);
        packages
            .manifest
            .push(npm.map(|(file, _)| *file).or(named.map(|(_, file)| *file)));
        packages.group.push(None);
        packages.code_files.push(index(code[row].len()));
        packages.entry.push(read.entry);
        let (routes, count, api) = match read.routes {
            Some((routes, count, api)) => (Some(routes), count, api),
            None => (None, 0, 0),
        };
        packages
            .routes
            .push(routes.and_then(|routes| dir_by_path.get(routes.as_str()).copied()));
        packages.route_count.push(count);
        packages.api_route_count.push(api);
    }
    packages
}

/// Pairs of packages (importing, imported) that a production import joins.
fn package_imports(
    input: &Input<'_>,
    package_of_dir: &[Option<u32>],
    package_of_file: &[Option<u32>],
) -> HashSet<(usize, usize)> {
    input
        .links
        .iter()
        .filter(|(from, _)| input.production[*from as usize])
        .filter_map(|&(from, dir)| {
            let from = package_of_file[from as usize]?;
            let to = package_of_dir[dir as usize]?;
            (from != to).then_some((from as usize, to as usize))
        })
        .collect()
}

/// Groups by the prefix of the packages' folder names; sets
/// [`Packages::group`]. The name of the repository, or of its root
/// manifest, names everything: it groups nothing.
fn group(
    input: &Input<'_>,
    manifests: &Manifests<'_>,
    packages: &mut Packages,
    imports: &HashSet<(usize, usize)>,
) -> PackageGroups {
    let names: Vec<&str> = packages
        .dir
        .iter()
        .map(|&dir| split_path(input.dir_paths[dir as usize]).1)
        .collect();
    let root = manifests
        .npm
        .get(&0)
        .and_then(|(_, npm)| npm.name.as_deref())
        .or_else(|| {
            manifests
                .named
                .get(&0)
                .and_then(|(name, _)| name.as_deref())
        });
    let namespaces: Vec<&str> = [Some(input.repo), root].into_iter().flatten().collect();
    let mut groups = PackageGroups::default();
    for (row, group) in groups::groups(&names, imports, &namespaces)
        .into_iter()
        .enumerate()
    {
        for member in group.members {
            packages.group[member] = Some(index(row));
        }
        groups.prefix.push(group.prefix);
        groups.linked.push(group.linked);
    }
    groups
}

fn externals(
    input: &Input<'_>,
    manifests: &Manifests<'_>,
    package_of_file: &[Option<u32>],
) -> Externals {
    let mut externals = Externals::default();
    for (package, name, files) in externals::count(&externals::Input {
        parents: input.parents,
        file_dirs: input.file_dirs,
        languages: input.languages,
        production: input.production,
        packages: package_of_file,
        imports: input.imports,
        outcomes: input.outcomes,
        declared: &manifests.declared,
    }) {
        externals.package.push(package);
        externals.name.push(name);
        externals.files.push(files);
    }
    externals
}

/// The manifests by folder, read once.
#[derive(Default)]
struct Manifests<'a> {
    /// The `package.json` of a folder, with its file.
    npm: HashMap<u32, (u32, manifest::Npm)>,
    /// Python projects declared by `pyproject.toml` and `requirements*.txt`,
    /// as pip compares them.
    python: HashMap<u32, BTreeSet<String>>,
    /// The name its `pyproject.toml` or `go.mod` gives a folder, with the
    /// file.
    named: HashMap<u32, (Option<String>, u32)>,
    declared: HashMap<u32, Declared>,
    /// Folders whose `pyproject.toml` declares a command.
    commands: HashSet<u32>,
    /// Every manifest of a folder, by file name.
    own: HashMap<u32, HashMap<&'a str, &'a [u8]>>,
}

impl<'a> Manifests<'a> {
    fn read(input: &Input<'a>, by_path: &HashMap<&str, u32>) -> Self {
        let dir_by_path: HashMap<&str, u32> = input
            .dir_paths
            .iter()
            .enumerate()
            .map(|(row, &path)| (path, index(row)))
            .collect();
        let mut read = Self::default();
        for &(path, content) in input.manifests {
            let (dir, name) = split_path(path);
            let (Some(&dir), Some(&file)) = (dir_by_path.get(dir), by_path.get(path)) else {
                continue;
            };
            read.own.entry(dir).or_default().insert(name, content);
            let python = match name {
                "package.json" => {
                    if let Some(npm) = manifest::npm(content) {
                        let declared = read.declared.entry(dir).or_default();
                        declared.npm.extend(npm.declared.iter().cloned());
                        read.npm.insert(dir, (file, npm));
                    }
                    Vec::new()
                }
                "pyproject.toml" => {
                    let project = manifest::pyproject(content);
                    read.named.entry(dir).or_insert((project.name, file));
                    if project.scripts {
                        read.commands.insert(dir);
                    }
                    project.dependencies
                }
                "go.mod" => {
                    let declared = read.declared.entry(dir).or_default();
                    declared.go.extend(manifest::go_requires(content));
                    read.named.insert(dir, (manifest::go_module(content), file));
                    Vec::new()
                }
                _ if name.starts_with("requirements") && name.ends_with(".txt") => {
                    manifest::requirements(content)
                }
                _ => Vec::new(),
            };
            for project in python {
                let key = manifest::python_key(&project);
                read.python.entry(dir).or_default().insert(key.clone());
                let declared = read.declared.entry(dir).or_default();
                declared.python.entry(key).or_insert(project);
            }
        }
        read
    }
}

#[cfg(test)]
mod tests {
    use super::go_program_rank;

    fn entry<'a>(package: &str, module: &str, files: &[&'a str]) -> &'a str {
        files
            .iter()
            .copied()
            .min_by_key(|file| go_program_rank(package, file, module))
            .unwrap_or_default()
    }

    #[test]
    fn a_go_package_starts_where_go_lays_out_its_command() {
        // grafana: a generator at the top, a tool deep down, the server
        let grafana = [
            "kinds/gen.go",
            "devenv/docker/listener/main.go",
            "pkg/cmd/grafana/main.go",
        ];
        assert_eq!(entry("", "grafana", &grafana), "pkg/cmd/grafana/main.go");
        // An operator: main.go at the root before a docs generator
        assert_eq!(
            entry("", "operator", &["cmd/docs.go", "main.go"]),
            "main.go"
        );
        // A package in a folder, its own main.go
        assert_eq!(
            entry(
                "tools/cli",
                "cli",
                &["tools/cli/internal/gen/main.go", "tools/cli/main.go"]
            ),
            "tools/cli/main.go"
        );
        // No main.go: the shallowest program
        assert_eq!(entry("", "x", &["a/b/run.go", "a/run.go"]), "a/run.go");
    }
}
