//! The islands of the city, the imports between them, and the layers they
//! fall into.
//!
//! An island is a top-level folder, unless a folder holds more than half of
//! the production code: then it is split, its subfolders become islands, and
//! the files directly in it make an island of their own. vscode keeps all
//! its code under `src/vs`, so its islands are `base`, `platform`, `editor`,
//! `workbench`…, not one `src`.
//!
//! A monorepo gets one island per package, however little code it holds:
//! the folders above a package are split, and a package never is.

mod layers;

use std::collections::BTreeMap;

use model::{EdgeKind, Links};

use crate::graph::{Graph, Node};

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
/// `production` whether it is production code; `packages` the folders of
/// a monorepo's packages, none in another (`packages::monorepo_dirs`).
pub(crate) fn islands(
    parents: &[Option<u32>],
    file_dirs: &[u32],
    production: &[bool],
    packages: &[u32],
) -> Islands {
    let count = parents.len();
    let mut own = vec![false; count];
    let mut code = vec![0u64; count];
    for (&dir, &production) in file_dirs.iter().zip(production) {
        own[dir as usize] = true;
        code[dir as usize] += u64::from(production);
    }
    let mut package = vec![false; count];
    for &dir in packages {
        package[dir as usize] = true;
    }
    // Parents come first: going backwards adds each folder to its parent
    // once it holds its whole subtree
    let mut has_code_below = vec![false; count];
    let mut has_package_below = vec![false; count];
    for dir in (1..count).rev() {
        if let Some(parent) = parents[dir] {
            code[parent as usize] += code[dir];
            has_code_below[parent as usize] |= code[dir] > 0;
            has_package_below[parent as usize] |= package[dir] || has_package_below[dir];
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
        let most_code = has_code_below[dir] && code[dir] * 2 > total;
        split[dir] = parent.is_none()
            || (candidate && !package[dir] && (most_code || has_package_below[dir]));
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

/// One edge of the result, as links count it.
#[derive(Debug, Clone, Copy)]
pub(crate) struct LinkEdge {
    pub from_file: u32,
    /// The folder of the imported file, or the imported package.
    pub to_dir: u32,
    /// A plain import or re-export from a production file that is not a
    /// barrel to production code: one the layers are read from.
    pub layered: bool,
}

/// The imports between islands, from the edges of the result. `layers`
/// gives each island's layer, to count the imports that go up, barrels'
/// re-exports left out.
pub(crate) fn links(
    islands: &Islands,
    layers: &[Option<u32>],
    file_dirs: &[u32],
    barrels: &[bool],
    edges: impl Iterator<Item = LinkEdge>,
) -> Links {
    #[derive(Default)]
    struct Count {
        imports: u32,
        upward: u32,
        production: u32,
        production_upward: u32,
    }
    let mut counts: BTreeMap<(u32, u32), Count> = BTreeMap::new();
    for edge in edges {
        let from = islands.of_dir[file_dirs[edge.from_file as usize] as usize];
        let to = islands.of_dir[edge.to_dir as usize];
        if let (Some(from), Some(to)) = (from, to)
            && from != to
        {
            let up = matches!(
                (layers[from as usize], layers[to as usize]),
                (Some(low), Some(high)) if high > low
            ) && !barrels[edge.from_file as usize];
            let count = counts.entry((from, to)).or_default();
            count.imports += 1;
            count.upward += u32::from(up);
            count.production += u32::from(edge.layered);
            count.production_upward += u32::from(edge.layered && up);
        }
    }
    let mut links = Links::default();
    for ((from, to), count) in counts {
        links.from.push(from);
        links.to.push(to);
        links.imports.push(count.imports);
        links.upward.push(count.upward);
        links.production.push(count.production);
        links.production_upward.push(count.production_upward);
    }
    links
}

/// The layer of each island, from the plain imports and re-exports between
/// production files, barrels left out; `None` for an island without
/// production code. In a monorepo, `packages` holds the folders of all its
/// packages, the root one included; none in another repository. An island
/// outside them all, such as `scripts/`, has no layer, and its imports
/// count for no other.
pub(crate) fn layers(
    graph: &Graph,
    islands: &Islands,
    parents: &[Option<u32>],
    file_dirs: &[u32],
    packages: &[u32],
) -> Vec<Option<u32>> {
    let layered = in_packages(islands, parents, packages);
    let island_of = |file: u32| {
        islands.of_dir[file_dirs[file as usize] as usize].filter(|&island| layered[island as usize])
    };
    let counted = |file: u32| graph.is_production(file) && !graph.is_barrel(file);
    let mut production = vec![false; islands.dirs.len()];
    let mut imports: Vec<(u32, u32)> = Vec::new();
    for file in (0..crate::saturating_u32(graph.file_count())).filter(|&file| counted(file)) {
        let Some(from) = island_of(file) else {
            continue;
        };
        production[from as usize] = true;
        for edge in graph.production_edges(file) {
            if !matches!(edge.kind, EdgeKind::Import | EdgeKind::Reexport) {
                continue;
            }
            let to = match edge.to {
                Node::File(to) if counted(to) => island_of(to),
                Node::File(_) => None,
                Node::Dir(dir) => {
                    islands.of_dir[dir as usize].filter(|&island| layered[island as usize])
                }
            };
            if let Some(to) = to {
                imports.push((from, to));
            }
        }
    }
    layers::layers(islands.dirs.len(), imports.into_iter())
        .into_iter()
        .zip(production)
        .map(|(layer, production)| production.then_some(layer))
        .collect()
}

/// Whether each island lies in a package; all of them without packages.
fn in_packages(islands: &Islands, parents: &[Option<u32>], packages: &[u32]) -> Vec<bool> {
    if packages.is_empty() {
        return vec![true; islands.dirs.len()];
    }
    // Parents come first: a folder is in a package when its parent is
    let mut inside = vec![false; parents.len()];
    for &dir in packages {
        inside[dir as usize] = true;
    }
    for dir in 0..parents.len() {
        if let Some(parent) = parents[dir] {
            inside[dir] |= inside[parent as usize];
        }
    }
    islands
        .dirs
        .iter()
        .map(|&dir| inside[dir as usize])
        .collect()
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
        let islands = islands(&parents, &[0, 1, 1, 2], &[true, true, true, false], &[]);
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
        let islands = islands(&parents, &file_dirs, &production, &[]);
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
        let islands = islands(&parents, &[2, 3, 4, 4], &[true, true, true, true], &[]);
        assert_eq!(islands.dirs, [1, 4]);
        assert_eq!(islands.of_dir, [None, Some(0), Some(0), Some(0), Some(1)]);
    }

    #[test]
    fn without_production_code_top_level_folders_stay_whole() {
        let parents = tree(&["", "docs", "docs/guide"]);
        let islands = islands(&parents, &[0, 2], &[false, false], &[]);
        assert_eq!(islands.dirs, [0, 1]);
        assert_eq!(islands.of_dir, [Some(0), Some(1), Some(1)]);
    }

    #[test]
    fn a_package_is_one_island_even_with_most_of_the_code() {
        let parents = tree(&[
            "",
            "apps",
            "apps/web",
            "apps/web/src",
            "libs",
            "libs/a",
            "libs/b",
            "docs",
        ]);
        // `web` holds 5 of 7 production files, each library one
        let file_dirs = [2, 3, 3, 3, 3, 5, 6, 7];
        let production = [true, true, true, true, true, true, true, false];
        let islands = islands(&parents, &file_dirs, &production, &[2, 5, 6]);
        assert_eq!(islands.dirs, [2, 5, 6, 7]);
        assert_eq!(
            islands.of_dir,
            [
                None,
                None,
                Some(0),
                Some(0),
                None,
                Some(1),
                Some(2),
                Some(3)
            ]
        );
    }

    #[test]
    fn folders_above_packages_are_split_whatever_code_they_hold() {
        // `code/libs` holds half of the code, not more: only its packages
        // split it, two levels down; its own file and `c`, which is not a
        // package, make islands of their own
        let parents = tree(&[
            "",
            "code",
            "code/libs",
            "code/libs/a",
            "code/libs/b",
            "code/libs/c",
            "code/tool",
        ]);
        let file_dirs = [2, 3, 4, 5, 6, 6, 6, 6];
        let islands = islands(&parents, &file_dirs, &[true; 8], &[3, 4]);
        assert_eq!(islands.dirs, [2, 3, 4, 5, 6]);
        assert_eq!(
            islands.of_dir,
            [None, None, Some(0), Some(1), Some(2), Some(3), Some(4)]
        );
    }

    #[test]
    fn links_count_imports_between_islands_only() {
        // Files: root, a, b, and a barrel in a; `b` is above `a`
        let parents = tree(&["", "a", "b"]);
        let file_dirs = [0, 1, 2, 1];
        let islands = islands(&parents, &file_dirs, &[false, true, true, true], &[]);
        let layers = [None, Some(1), Some(2)];
        let barrels = [false, false, false, true];
        // a → b twice (once from a test) and from the barrel, b → a, a → a,
        // root → b; what the layers read is said by the edge
        let edges = [
            (1, 2, true),
            (1, 2, false),
            (3, 2, false),
            (2, 1, true),
            (1, 1, true),
            (0, 2, true),
        ]
        .map(|(from_file, to_dir, layered)| LinkEdge {
            from_file,
            to_dir,
            layered,
        });
        let links = links(&islands, &layers, &file_dirs, &barrels, edges.into_iter());
        assert_eq!(links.from, [0, 1, 2]);
        assert_eq!(links.to, [2, 2, 1]);
        assert_eq!(links.imports, [1, 3, 1]);
        // The barrel offers what it re-exports: it does not go up
        assert_eq!(links.upward, [0, 2, 0]);
        assert_eq!(links.production, [1, 1, 1]);
        assert_eq!(links.production_upward, [0, 1, 0]);
    }
}
