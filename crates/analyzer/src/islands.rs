//! The islands of the city, and the imports between them.
//!
//! An island is a top-level folder, unless a folder holds more than half of
//! the production code: then it is split, its subfolders become islands, and
//! the files directly in it make an island of their own. vscode keeps all
//! its code under `src/vs`, so its islands are `base`, `platform`, `editor`,
//! `workbench`…, not one `src`; a monorepo gets one island per package.

use std::collections::BTreeMap;

use model::Links;

/// The islands of a folder tree.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Islands {
    /// The island of each folder's own files; `None` for a folder split
    /// into islands that holds no file of its own.
    pub of_dir: Vec<Option<u32>>,
    /// The folder each island is named after, in folder order.
    pub dirs: Vec<u32>,
}

/// Splits the tree into islands. `parents` is the parent of each folder,
/// each folder after its parent; `file_dirs` the folder of each file, and
/// `production` whether it is production code.
pub(crate) fn islands(parents: &[Option<u32>], file_dirs: &[u32], production: &[bool]) -> Islands {
    let count = parents.len();
    let mut own = vec![false; count];
    let mut code = vec![0u64; count];
    for (&dir, &production) in file_dirs.iter().zip(production) {
        own[dir as usize] = true;
        code[dir as usize] += u64::from(production);
    }
    // Parents come first: going backwards adds each folder to its parent
    // once it holds its whole subtree
    let mut has_code_below = vec![false; count];
    for dir in (1..count).rev() {
        if let Some(parent) = parents[dir] {
            code[parent as usize] += code[dir];
            has_code_below[parent as usize] |= code[dir] > 0;
        }
    }
    let total = code.first().copied().unwrap_or(0);

    let mut split = vec![false; count];
    let mut islands = Islands {
        of_dir: Vec::with_capacity(count),
        dirs: Vec::new(),
    };
    for dir in 0..count {
        let parent = parents[dir].map(|parent| parent as usize);
        // Only a folder that would be an island is split
        let candidate = parent.is_none_or(|parent| split[parent]);
        split[dir] =
            parent.is_none() || (candidate && has_code_below[dir] && code[dir] * 2 > total);
        let island = if split[dir] && !own[dir] {
            None
        } else if candidate {
            islands.dirs.push(crate::saturating_u32(dir));
            Some(crate::saturating_u32(islands.dirs.len() - 1))
        } else {
            parent.and_then(|parent| islands.of_dir[parent])
        };
        islands.of_dir.push(island);
    }
    islands
}

/// The imports between islands, from the edges of the result: `(importing
/// file, imported folder)`, the folder of the imported file or the imported
/// package.
pub(crate) fn links(
    islands: &Islands,
    file_dirs: &[u32],
    edges: impl Iterator<Item = (u32, u32)>,
) -> Links {
    let mut counts: BTreeMap<(u32, u32), u32> = BTreeMap::new();
    for (from, to_dir) in edges {
        let from = islands.of_dir[file_dirs[from as usize] as usize];
        let to = islands.of_dir[to_dir as usize];
        if let (Some(from), Some(to)) = (from, to)
            && from != to
        {
            *counts.entry((from, to)).or_default() += 1;
        }
    }
    let mut links = Links::default();
    for ((from, to), imports) in counts {
        links.from.push(from);
        links.to.push(to);
        links.imports.push(imports);
    }
    links
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Folders by path, parents first: `""` is the root.
    fn tree(paths: &[&str]) -> Vec<Option<u32>> {
        paths
            .iter()
            .map(|path| {
                let parent = path.rsplit_once('/').map_or("", |(parent, _)| parent);
                (!path.is_empty()).then(|| {
                    crate::saturating_u32(paths.iter().position(|p| *p == parent).unwrap())
                })
            })
            .collect()
    }

    #[test]
    fn top_level_folders_are_islands_and_root_files_the_root_island() {
        // `lib` holds 2 of 3 production files, but nothing below it
        let parents = tree(&["", "lib", "test"]);
        let islands = islands(&parents, &[0, 1, 1, 2], &[true, true, true, false]);
        assert_eq!(islands.dirs, [0, 1, 2]);
        assert_eq!(islands.of_dir, [Some(0), Some(1), Some(2)]);
    }

    #[test]
    fn a_folder_with_most_of_the_code_is_split_down_a_chain() {
        // src (no file) → src/vs (nls.ts) → base, platform; and docs
        let parents = tree(&[
            "",
            "src",
            "src/vs",
            "src/vs/base",
            "src/vs/platform",
            "docs",
        ]);
        let file_dirs = [2, 3, 3, 4, 5];
        let production = [true, true, true, true, false];
        let islands = islands(&parents, &file_dirs, &production);
        // No root file: no root island; `src` holds no file of its own
        assert_eq!(islands.dirs, [2, 3, 4, 5]);
        assert_eq!(
            islands.of_dir,
            [None, None, Some(0), Some(1), Some(2), Some(3)]
        );
    }

    #[test]
    fn half_of_the_code_is_not_enough_to_split() {
        let parents = tree(&["", "a", "a/x", "a/y", "b"]);
        let islands = islands(&parents, &[2, 3, 4, 4], &[true, true, true, true]);
        assert_eq!(islands.dirs, [1, 4]);
        assert_eq!(islands.of_dir, [None, Some(0), Some(0), Some(0), Some(1)]);
    }

    #[test]
    fn without_production_code_top_level_folders_stay_whole() {
        let parents = tree(&["", "docs", "docs/guide"]);
        let islands = islands(&parents, &[0, 2], &[false, false]);
        assert_eq!(islands.dirs, [0, 1]);
        assert_eq!(islands.of_dir, [Some(0), Some(1), Some(1)]);
    }

    #[test]
    fn links_count_imports_between_islands_only() {
        let parents = tree(&["", "a", "b"]);
        let islands = islands(&parents, &[0, 1, 2], &[false, true, true]);
        // a → b twice, b → a, a → a, root → b
        let edges = [(1, 2), (1, 2), (2, 1), (1, 1), (0, 2)];
        let links = links(&islands, &[0, 1, 2], edges.into_iter());
        assert_eq!(links.from, [0, 1, 2]);
        assert_eq!(links.to, [2, 2, 1]);
        assert_eq!(links.imports, [1, 2, 1]);
    }
}
