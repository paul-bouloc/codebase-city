//! TypeScript and JavaScript, with `oxc_resolver` (the rules of Node and
//! TypeScript: extensions, `index`, `package.json`, tsconfig `paths`) on a
//! file system held in memory.
//!
//! There is no `node_modules`: the file system shows the repository's own
//! packages there instead, under their names, so the resolver reads their
//! `exports` and `main` as Node would. A package whose entry points to a
//! build that is not in the repository falls back on its sources.
//!
//! A tsconfig that extends a configuration missing from the repository
//! (`@vue/tsconfig`, `@tsconfig/node20`) would fail as a whole, its own
//! `paths` with it: the missing parents are left out of what it extends.
//! The resolver only looks for `tsconfig.json`: a `jsconfig.json` alone in
//! its folder is shown under that name, with the `allowJs` it implies.

use std::collections::{HashMap, HashSet};
use std::io;
use std::path::{Path, PathBuf};

use model::Confidence;
use oxc_resolver::{
    FileMetadata, FileSystem, ResolveError, ResolveOptions, ResolverGeneric, TsconfigDiscovery,
};
use serde::Deserialize;

use super::{Index, Outcome, Target, join, under};
use crate::files::split_path;

/// Extensions tried after a path without one, in this order. A
/// declaration (`.d.ts`) comes after the code it describes: the city shows
/// what runs.
const EXTENSIONS: &[&str] = &[
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".d.ts", ".json",
];

/// Endings tried after an import the resolver could not read: a file with
/// one of the extensions, or a folder's `index`.
const SUFFIX_ENDINGS: &[&str] = &[
    ".ts",
    ".tsx",
    ".d.ts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".mts",
    ".cts",
    "/index.ts",
    "/index.tsx",
    "/index.d.ts",
    "/index.js",
    "/index.jsx",
];

/// Where the repository is in [`MemoryFs`]. Not at `/`: the resolver does
/// not resolve the root folder itself (`require('../..')` from two levels
/// down), and `/node_modules` stays outside the repository.
const ROOT: &str = "/repo";

/// Folders whose `package.json` files are test material, not packages of
/// the repository: a fixture may be named like a real dependency.
const TEST_DIRS: &[&str] = &[
    "test",
    "tests",
    "__tests__",
    "fixture",
    "fixtures",
    "__fixtures__",
    "testdata",
    "__mocks__",
];

/// Files a folder can stand for, when its `package.json` does not lead to
/// a file of the repository.
const FOLDER_ENTRIES: &[&str] = &[
    "/src/index.ts",
    "/src/index.tsx",
    "/src/index.js",
    "/index.ts",
    "/index.tsx",
    "/index.js",
];

/// The packages of the repository: the folder of each, by name.
type Workspace = HashMap<String, String>;

pub(super) struct Resolver {
    /// With the nearest `tsconfig.json`.
    with_tsconfig: ResolverGeneric<MemoryFs>,
    /// For files whose tsconfig cannot be read, often because it extends a
    /// package that is not in the repository.
    plain: ResolverGeneric<MemoryFs>,
    workspace: Workspace,
    /// Packages the repository's `package.json` files depend on.
    dependencies: HashSet<String>,
    /// Folders at the root, which a bare import may name through an alias.
    top_dirs: HashSet<String>,
}

/// The fields of a `package.json` that resolution reads itself.
#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct PackageJson {
    name: Option<String>,
    dependencies: HashMap<String, serde::de::IgnoredAny>,
    dev_dependencies: HashMap<String, serde::de::IgnoredAny>,
    peer_dependencies: HashMap<String, serde::de::IgnoredAny>,
    optional_dependencies: HashMap<String, serde::de::IgnoredAny>,
}

impl Resolver {
    pub(super) fn new(index: &Index<'_>, manifests: &HashMap<&str, &[u8]>) -> Self {
        let mut workspace = Workspace::new();
        let mut dependencies = HashSet::new();
        let mut packages: Vec<(&str, &[u8])> = manifests
            .iter()
            .filter(|(path, _)| split_path(path).1 == "package.json")
            .filter(|(path, _)| !path.split('/').any(|part| TEST_DIRS.contains(&part)))
            .map(|(path, content)| (*path, *content))
            .collect();
        // When two packages share a name, the one nearest the root wins
        packages.sort_unstable_by_key(|&(path, _)| (path.matches('/').count(), path));
        for (path, content) in packages {
            let Ok(package) = serde_json::from_slice::<PackageJson>(content) else {
                continue;
            };
            if let Some(name) = package.name.filter(|name| !name.is_empty()) {
                workspace
                    .entry(name)
                    .or_insert_with(|| split_path(path).0.to_owned());
            }
            for names in [
                package.dependencies,
                package.dev_dependencies,
                package.peer_dependencies,
                package.optional_dependencies,
            ] {
                dependencies.extend(names.into_keys());
            }
        }

        let fs = MemoryFs::new(index, manifests, workspace.clone());
        let options = ResolveOptions {
            extensions: EXTENSIONS.iter().map(|&ext| ext.to_owned()).collect(),
            // ESM written in TypeScript imports `./a.js` for `a.ts`
            extension_alias: vec![
                (
                    ".js".into(),
                    vec![".ts".into(), ".tsx".into(), ".js".into(), ".d.ts".into()],
                ),
                (".jsx".into(), vec![".tsx".into(), ".jsx".into()]),
                (".mjs".into(), vec![".mts".into(), ".mjs".into()]),
                (".cjs".into(), vec![".cts".into(), ".cjs".into()]),
            ],
            // Not `types`: it wins over `default` in `exports` and names a
            // declaration, often of a build that is not in the repository
            condition_names: ["import", "require", "node", "default"]
                .map(String::from)
                .to_vec(),
            // Not `types`, which names a declaration
            main_fields: ["module", "main"].map(String::from).to_vec(),
            main_files: vec!["index".into()],
            builtin_modules: true,
            // `/src/main.ts` is from the root of the repository, as for Vite
            roots: vec![PathBuf::from(ROOT)],
            symlinks: false,
            ..ResolveOptions::default()
        };
        let plain = ResolverGeneric::new_with_file_system(fs, options.clone());
        let with_tsconfig = plain.clone_with_options(ResolveOptions {
            tsconfig: Some(TsconfigDiscovery::Auto),
            ..options
        });
        let top_dirs = index
            .dirs
            .iter()
            .filter(|dir| !dir.is_empty() && !dir.contains('/'))
            .map(|&dir| dir.to_owned())
            .collect();
        Self {
            with_tsconfig,
            plain,
            workspace,
            dependencies,
            top_dirs,
        }
    }

    pub(super) fn resolve(&self, index: &Index<'_>, path: &str, specifier: &str) -> Outcome {
        let file = in_memory(path);
        let resolved = match self.with_tsconfig.resolve_file(&file, specifier) {
            Err(error) if is_tsconfig_error(&error) => self.plain.resolve_file(&file, specifier),
            other => other,
        };
        match resolved {
            Ok(resolution) => {
                let found = in_repository(&self.workspace, resolution.path());
                if let Some(row) = found.and_then(|path| index.file(&path)) {
                    return exact(row);
                }
            }
            Err(ResolveError::Builtin { .. }) => return Outcome::External,
            Err(_) => {}
        }

        let relative = specifier.starts_with('.') || specifier.starts_with('/');
        if relative {
            let base = split_path(path).0;
            let target = match specifier.strip_prefix('/') {
                Some(absolute) => join("", absolute),
                None => join(base, specifier),
            };
            // A guess, unlike a package of the repository, whose sources
            // are what its build is made from
            return match target.and_then(|dir| folder_entry(index, &dir)) {
                Some(row) => Outcome::Resolved(vec![(Target::File(row), Confidence::Likely)]),
                None => Outcome::Unresolved,
            };
        }

        let package = package_name(specifier);
        if let Some((name, dir)) = self.workspace_package(package) {
            let rest = specifier[name.len()..].trim_start_matches('/');
            if let Some(found) = package_sources(index, name, dir, rest) {
                return Outcome::Resolved(vec![found]);
            }
            // A folder of the repository named like a package it depends
            // on, such as an extension named `typescript`
            if !self.dependencies.contains(package) {
                return Outcome::Unresolved;
            }
        }
        if self.dependencies.contains(package) {
            return Outcome::External;
        }

        // An alias the resolver could not read: Vite, webpack, Babel. A
        // bare name alone (`redis`) is a package far more often than a file
        let aliased = specifier.starts_with(['~', '#']) || specifier.starts_with("@/");
        let suffix = specifier
            .trim_start_matches(['@', '~', '#'])
            .trim_start_matches('/');
        let scoped = specifier.starts_with('@') && !specifier.starts_with("@/");
        if !scoped
            && (aliased || suffix.contains('/'))
            && let Some(row) = index.by_suffix(suffix, SUFFIX_ENDINGS)
        {
            return Outcome::Resolved(vec![(Target::File(row), Confidence::Likely)]);
        }
        let looks_internal = aliased || self.top_dirs.contains(package);
        if looks_internal {
            Outcome::Unresolved
        } else {
            Outcome::Undeclared(package.to_owned())
        }
    }

    /// The package of the repository named `package`, with its folder.
    fn workspace_package(&self, package: &str) -> Option<(&str, &str)> {
        self.workspace
            .get_key_value(package)
            .map(|(name, dir)| (name.as_str(), dir.as_str()))
    }
}

fn exact(row: u32) -> Outcome {
    Outcome::Resolved(vec![(Target::File(row), Confidence::Exact)])
}

/// Errors that come from reading a tsconfig, rather than from the import.
fn is_tsconfig_error(error: &ResolveError) -> bool {
    matches!(
        error,
        ResolveError::TsconfigNotFound(_)
            | ResolveError::TsconfigSelfReference(_)
            | ResolveError::TsconfigCircularExtend(_)
            | ResolveError::TsconfigLoadFailed { .. }
            | ResolveError::Json(_)
            | ResolveError::IOError(_)
    )
}

/// `react` for `react/jsx-runtime`, `@acme/ui` for `@acme/ui/button`.
fn package_name(specifier: &str) -> &str {
    let mut ends = specifier.match_indices('/').map(|(at, _)| at);
    let end = if specifier.starts_with('@') {
        ends.nth(1)
    } else {
        ends.next()
    };
    &specifier[..end.unwrap_or(specifier.len())]
}

/// The file of the package `name`, in `dir`, that `name/rest` stands for,
/// when its `package.json` leads to a build that is not in the repository.
/// The sources are tried, then a file of `src` named after the import
/// (`three` gives `src/Three.js`, `three/webgpu` gives `src/Three.WebGPU.js`),
/// which is only likely.
fn package_sources(
    index: &Index<'_>,
    name: &str,
    dir: &str,
    rest: &str,
) -> Option<(Target, Confidence)> {
    let within = |path: &str| under(dir, path);
    let exact = if rest.is_empty() {
        folder_entry(index, dir)
    } else {
        with_extension(index, &within(rest))
            .or_else(|| with_extension(index, &within(&format!("src/{rest}"))))
    };
    if let Some(row) = exact {
        return Some((Target::File(row), Confidence::Exact));
    }
    let last = name.rsplit('/').next().unwrap_or(name).to_lowercase();
    let wanted = if rest.is_empty() {
        last
    } else {
        format!("{last}.{}", rest.to_lowercase())
    };
    let mut candidates = index.files_in(&within("src")).iter().filter(|&&row| {
        let file = split_path(index.path(row)).1.to_lowercase();
        file.rsplit_once('.')
            .is_some_and(|(stem, ext)| stem == wanted && matches!(ext, "ts" | "tsx" | "js" | "mjs"))
    });
    match (candidates.next(), candidates.next()) {
        (Some(&row), None) => Some((Target::File(row), Confidence::Likely)),
        _ => None,
    }
}

/// The file a folder stands for when its `package.json` leads nowhere.
fn folder_entry(index: &Index<'_>, dir: &str) -> Option<u32> {
    if !index.is_dir(dir) {
        return None;
    }
    FOLDER_ENTRIES
        .iter()
        .find_map(|entry| index.file(format!("{dir}{entry}").trim_start_matches('/')))
}

/// The file at `path`, as written or with one of the extensions.
fn with_extension(index: &Index<'_>, path: &str) -> Option<u32> {
    index.file(path).or_else(|| {
        EXTENSIONS
            .iter()
            .find_map(|ext| index.file(&format!("{path}{ext}")))
    })
}

/// A TypeScript or JavaScript configuration: `tsconfig.json`,
/// `tsconfig.app.json`, `jsconfig.json`…
fn is_config(path: &str) -> bool {
    let name = split_path(path).1;
    (name.starts_with("tsconfig") || name.starts_with("jsconfig")) && name.ends_with(".json")
}

/// A configuration read as JSON with comments and trailing commas.
fn read_config(content: &[u8]) -> Option<serde_json::Value> {
    let mut json = content
        .strip_prefix(b"\xEF\xBB\xBF")
        .unwrap_or(content)
        .to_vec();
    json_strip_comments::strip_slice(&mut json).ok()?;
    serde_json::from_slice(&json).ok()
}

/// A `jsconfig.json` as the `tsconfig.json` it stands for: JavaScript files
/// belong to it, which a tsconfig only says with `allowJs`.
fn allowing_js(content: &[u8]) -> Option<Vec<u8>> {
    let mut config = read_config(content)?;
    let options = config
        .as_object_mut()?
        .entry("compilerOptions")
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()))
        .as_object_mut()?;
    options.insert("allowJs".to_owned(), serde_json::Value::Bool(true));
    serde_json::to_vec(&config).ok()
}

/// The configuration at `path` without the parents of its `extends` that
/// are not in the repository; `None` when it needs no change or cannot be
/// read (the resolver then reports it, and resolution goes on without it).
fn without_missing_extends(
    index: &Index<'_>,
    workspace: &Workspace,
    path: &str,
    content: &[u8],
) -> Option<Vec<u8>> {
    let mut config = read_config(content)?;
    let object = config.as_object_mut()?;
    let dir = split_path(path).0;
    let exists = |parent: &str| {
        if parent.starts_with('.') || parent.starts_with('/') {
            let target = match parent.strip_prefix('/') {
                Some(absolute) => join("", absolute),
                None => join(dir, parent),
            };
            target.is_some_and(|target| {
                index.file(&target).is_some() || index.file(&format!("{target}.json")).is_some()
            })
        } else {
            workspace.contains_key(package_name(parent))
        }
    };
    let kept = match object.get("extends")? {
        serde_json::Value::String(parent) if exists(parent) => return None,
        serde_json::Value::String(_) => None,
        serde_json::Value::Array(parents) => {
            let kept: Vec<_> = parents
                .iter()
                .filter(|parent| parent.as_str().is_some_and(exists))
                .cloned()
                .collect();
            if kept.len() == parents.len() {
                return None;
            }
            Some(serde_json::Value::Array(kept))
        }
        _ => return None,
    };
    match kept {
        Some(parents) => object.insert("extends".to_owned(), parents),
        None => object.remove("extends"),
    };
    serde_json::to_vec(&config).ok()
}

/// The path in [`MemoryFs`] of a path of the repository.
fn in_memory(path: &str) -> PathBuf {
    Path::new(ROOT).join(path)
}

/// Where a path of [`MemoryFs`] is in the repository: a path under
/// `/node_modules` is a package of the repository, shown there by name.
fn in_repository(workspace: &Workspace, path: &Path) -> Option<String> {
    let path = path.to_str()?;
    let Some(rest) = path.strip_prefix("/node_modules/") else {
        let inside = path.strip_prefix(ROOT)?;
        if !inside.is_empty() && !inside.starts_with('/') {
            return None;
        }
        return Some(inside.trim_start_matches('/').to_owned());
    };
    let name = package_name(rest);
    let dir = workspace.get(name)?;
    Some(under(dir, rest[name.len()..].trim_start_matches('/')))
}

/// The repository as a read-only file system rooted at `/`, with its own
/// packages under `/node_modules`. Only the manifests have a content; every
/// other file is only known to exist.
struct MemoryFs {
    files: HashSet<PathBuf>,
    dirs: HashSet<PathBuf>,
    contents: HashMap<PathBuf, Vec<u8>>,
    workspace: Workspace,
}

impl MemoryFs {
    fn new(index: &Index<'_>, manifests: &HashMap<&str, &[u8]>, workspace: Workspace) -> Self {
        let absolute = |path: &str| in_memory(path);
        let mut dirs: HashSet<PathBuf> = index.dirs.iter().map(|dir| absolute(dir)).collect();
        dirs.insert(PathBuf::from("/"));
        dirs.insert(PathBuf::from("/node_modules"));
        // `/node_modules/@scope` holds the packages of that scope
        for name in workspace.keys() {
            if let Some((scope, _)) = name.split_once('/') {
                dirs.insert(PathBuf::from(format!("/node_modules/{scope}")));
            }
        }
        let mut files: HashSet<PathBuf> = index.paths.iter().map(|path| absolute(path)).collect();
        let mut contents = HashMap::with_capacity(manifests.len());
        for (path, content) in manifests {
            let content = if is_config(path) {
                without_missing_extends(index, &workspace, path, content)
                    .unwrap_or_else(|| content.to_vec())
            } else {
                content.to_vec()
            };
            let (dir, name) = split_path(path);
            let tsconfig = under(dir, "tsconfig.json");
            if name == "jsconfig.json"
                && index.file(&tsconfig).is_none()
                && let Some(as_tsconfig) = allowing_js(&content)
            {
                files.insert(absolute(&tsconfig));
                contents.insert(absolute(&tsconfig), as_tsconfig);
            }
            contents.insert(absolute(path), content);
        }
        Self {
            files,
            dirs,
            contents,
            workspace,
        }
    }

    /// The path in the repository that `path` shows.
    fn real(&self, path: &Path) -> Option<PathBuf> {
        let inside = in_repository(&self.workspace, path)?;
        Some(in_memory(&inside))
    }

    fn not_found() -> io::Error {
        io::Error::from(io::ErrorKind::NotFound)
    }
}

impl FileSystem for MemoryFs {
    fn new() -> Self {
        Self {
            files: HashSet::new(),
            dirs: HashSet::new(),
            contents: HashMap::new(),
            workspace: Workspace::new(),
        }
    }

    fn read(&self, path: &Path) -> io::Result<Vec<u8>> {
        let real = self.real(path).ok_or_else(Self::not_found)?;
        self.contents
            .get(&real)
            .cloned()
            .ok_or_else(Self::not_found)
    }

    fn read_to_string(&self, path: &Path) -> io::Result<String> {
        let bytes = self.read(path)?;
        String::from_utf8(bytes).map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
    }

    fn metadata(&self, path: &Path) -> io::Result<FileMetadata> {
        if self.dirs.contains(path) {
            return Ok(FileMetadata::new(false, true, false));
        }
        let real = self.real(path).ok_or_else(Self::not_found)?;
        if self.files.contains(&real) {
            Ok(FileMetadata::new(true, false, false))
        } else if self.dirs.contains(&real) {
            Ok(FileMetadata::new(false, true, false))
        } else {
            Err(Self::not_found())
        }
    }

    fn symlink_metadata(&self, path: &Path) -> io::Result<FileMetadata> {
        self.metadata(path)
    }

    fn read_link(&self, _path: &Path) -> Result<PathBuf, ResolveError> {
        Err(io::Error::from(io::ErrorKind::InvalidInput).into())
    }

    fn canonicalize(&self, path: &Path) -> io::Result<PathBuf> {
        self.metadata(path).map(|_| path.to_path_buf())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_package_name_keeps_its_scope() {
        assert_eq!(package_name("react"), "react");
        assert_eq!(package_name("react/jsx-runtime"), "react");
        assert_eq!(package_name("@acme/ui/button"), "@acme/ui");
        assert_eq!(package_name("@acme/ui"), "@acme/ui");
    }
}
