//! The repository as a file system for `oxc_resolver`, held in memory,
//! with its own packages shown under `node_modules`.

use std::collections::{HashMap, HashSet};
use std::io;
use std::path::{Path, PathBuf};

use oxc_resolver::{FileMetadata, FileSystem, ResolveError};

use super::{Workspace, package_name};
use crate::files::split_path;
use crate::resolve::{Index, join, under};

/// Where the repository is in [`MemoryFs`]. Not at `/`: the resolver does
/// not resolve the root folder itself (`require('../..')` from two levels
/// down), and `/node_modules` stays outside the repository.
pub(super) const ROOT: &str = "/repo";

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
pub(super) fn in_memory(path: &str) -> PathBuf {
    Path::new(ROOT).join(path)
}

/// Where a path of [`MemoryFs`] is in the repository: a path under
/// `/node_modules` is a package of the repository, shown there by name.
pub(super) fn in_repository(workspace: &Workspace, path: &Path) -> Option<String> {
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
pub(super) struct MemoryFs {
    files: HashSet<PathBuf>,
    dirs: HashSet<PathBuf>,
    contents: HashMap<PathBuf, Vec<u8>>,
    workspace: Workspace,
}

impl MemoryFs {
    pub(super) fn new(
        index: &Index<'_>,
        manifests: &HashMap<&str, &[u8]>,
        workspace: Workspace,
    ) -> Self {
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
