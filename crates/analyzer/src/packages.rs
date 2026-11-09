//! The packages of a monorepo: the folders its workspace declares, what each
//! one is (an app or a library), the framework it is built with and where
//! it starts, the prefixes that group them; and, for every repository, the
//! dependencies the production code imports.

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
    pub workspace: Option<Workspace>,
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
    let declaration = workspace::declaration(input.manifests);
    let mut dirs = Vec::new();
    let mut package_of_dir = vec![None; input.dir_paths.len()];
    if let Some(declaration) = &declaration {
        found.workspace = by_path
            .get(declaration.manifest.as_str())
            .map(|&manifest| Workspace {
                kind: declaration.kind,
                manifest,
            });
        dirs = package_dirs(input, declaration);
        for (row, &dir) in dirs.iter().enumerate() {
            package_of_dir[dir as usize] = Some(index(row));
        }
        // Parents come first: a folder inherits its parent's package
        for dir in 1..input.dir_paths.len() {
            if package_of_dir[dir].is_none() {
                package_of_dir[dir] =
                    input.parents[dir].and_then(|parent| package_of_dir[parent as usize]);
            }
        }
    }
    let package_of_file: Vec<Option<u32>> = input
        .file_dirs
        .iter()
        .map(|&dir| package_of_dir[dir as usize])
        .collect();
    found.packages = packages(input, &manifests, &dirs, &package_of_file, &by_path);
    found.groups = group(
        input,
        &mut found.packages,
        &package_of_dir,
        &package_of_file,
    );
    found.externals = externals(input, &manifests, &package_of_file);
    found
}

/// The folders the declaration matches that hold an analyzed file, the
/// outermost of nested ones, in folder order.
fn package_dirs(input: &Input<'_>, declaration: &workspace::Declaration) -> Vec<u32> {
    let count = input.dir_paths.len();
    let mut has_code = vec![false; count];
    for (&dir, language) in input.file_dirs.iter().zip(input.languages) {
        has_code[dir as usize] |= language.is_analyzed();
    }
    // Children come after their parent: going backwards adds each subtree
    for dir in (1..count).rev() {
        if let Some(parent) = input.parents[dir] {
            has_code[parent as usize] |= has_code[dir];
        }
    }
    let mut inside = vec![false; count];
    let mut dirs = Vec::new();
    for dir in 1..count {
        let parent = input.parents[dir].is_some_and(|parent| inside[parent as usize]);
        let package = !parent && has_code[dir] && declaration.matches(input.dir_paths[dir]);
        inside[dir] = parent || package;
        if package {
            dirs.push(index(dir));
        }
    }
    dirs
}

fn packages(
    input: &Input<'_>,
    manifests: &Manifests<'_>,
    dirs: &[u32],
    package_of_file: &[Option<u32>],
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
        let go_main = code[row].iter().find_map(|&(_, file)| {
            (input.languages[file as usize] == Language::Go && input.mains[file as usize])
                .then_some(file)
        });
        let read = framework::read(&framework::Package {
            dir: path,
            npm: npm.map(|(_, npm)| npm),
            python: manifests.python.get(&dir).unwrap_or(&no_python),
            own: manifests.own.get(&dir).unwrap_or(&no_manifests),
            code: &code[row],
            start,
            go_main,
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

/// Groups by the prefix of the packages' folder names; sets
/// [`Packages::group`].
fn group(
    input: &Input<'_>,
    packages: &mut Packages,
    package_of_dir: &[Option<u32>],
    package_of_file: &[Option<u32>],
) -> PackageGroups {
    let names: Vec<&str> = packages
        .dir
        .iter()
        .map(|&dir| split_path(input.dir_paths[dir as usize]).1)
        .collect();
    let imports: HashSet<(usize, usize)> = input
        .links
        .iter()
        .filter(|(from, _)| input.production[*from as usize])
        .filter_map(|&(from, dir)| {
            let from = package_of_file[from as usize]?;
            let to = package_of_dir[dir as usize]?;
            (from != to).then_some((from as usize, to as usize))
        })
        .collect();
    let mut groups = PackageGroups::default();
    for (row, group) in groups::groups(&names, &imports).into_iter().enumerate() {
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
                    let (project, dependencies) = manifest::pyproject(content);
                    read.named.entry(dir).or_insert((project, file));
                    dependencies
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
