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

mod memory_fs;

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use model::Confidence;
use oxc_resolver::{ResolveError, ResolveOptions, ResolverGeneric, TsconfigDiscovery};
use serde::Deserialize;

use super::{Index, Outcome, Target, join, under};
use crate::files::split_path;
use memory_fs::{MemoryFs, ROOT, in_memory, in_repository};

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
    /// Any value, so that a `"true"` written as a string does not lose the
    /// whole manifest.
    private: Option<serde_json::Value>,
    workspaces: Option<serde::de::IgnoredAny>,
    dependencies: HashMap<String, serde::de::IgnoredAny>,
    dev_dependencies: HashMap<String, serde::de::IgnoredAny>,
    peer_dependencies: HashMap<String, serde::de::IgnoredAny>,
    optional_dependencies: HashMap<String, serde::de::IgnoredAny>,
}

impl Resolver {
    pub(super) fn new(index: &Index<'_>, manifests: &HashMap<&str, &[u8]>) -> Self {
        let mut workspace = Workspace::new();
        let mut dependencies = HashSet::new();
        let mut packages: Vec<(&str, PackageJson)> = manifests
            .iter()
            .filter(|(path, _)| split_path(path).1 == "package.json")
            .filter(|(path, _)| !path.split('/').any(|part| TEST_DIRS.contains(&part)))
            .filter_map(|(path, content)| Some((*path, serde_json::from_slice(content).ok()?)))
            .collect();
        // When two packages share a name, a published one wins over the root
        // of a monorepo (nest names its root `@nestjs/core`) or a private
        // one, then the one nearest the root
        packages.sort_unstable_by_key(|(path, package)| {
            let private = matches!(
                package.private,
                Some(serde_json::Value::Bool(true))
            ) || matches!(&package.private, Some(serde_json::Value::String(text)) if text == "true");
            let unpublished = private || package.workspaces.is_some();
            (unpublished, path.matches('/').count(), *path)
        });
        for (path, package) in packages {
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
        // `https://esm.sh/react`, `//cdn.example.com/lib.js`; the resolver
        // also asserts, in debug builds, that `//` starts no path
        if specifier.contains("://") || specifier.starts_with("//") {
            return Outcome::External;
        }
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
pub(crate) fn package_name(specifier: &str) -> &str {
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
