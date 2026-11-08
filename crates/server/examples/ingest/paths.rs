//! Paths of files and folders, rebuilt from the tables of a result.

use model::AnalysisResult;

/// The path of a file, rebuilt from the folder table.
pub(crate) fn path(result: &AnalysisResult, file: usize) -> String {
    let mut parts = vec![result.files.name[file].as_str()];
    let mut dir = result.files.dir[file] as usize;
    while let Some(parent) = result.dirs.parent[dir] {
        parts.push(&result.dirs.name[dir]);
        dir = parent as usize;
    }
    parts.reverse();
    parts.join("/")
}

/// The path of a folder, rebuilt from the folder table, with a final `/`.
pub(crate) fn dir_path(result: &AnalysisResult, dir: u32) -> String {
    let mut parts = Vec::new();
    let mut current = dir as usize;
    while let Some(parent) = result.dirs.parent[current] {
        parts.push(result.dirs.name[current].as_str());
        current = parent as usize;
    }
    parts.reverse();
    format!("{}/", parts.join("/"))
}

pub(crate) fn target(result: &AnalysisResult, file: Option<u32>, dir: Option<u32>) -> String {
    match (file, dir) {
        (Some(file), _) => path(result, file as usize),
        (_, Some(dir)) => dir_path(result, dir),
        _ => String::new(),
    }
}
