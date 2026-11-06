//! Where everything stands in the city: the plateau of each island, the
//! parcel of each folder and the lot of each file.
//!
//! Each island is a treemap of its folders, each folder a parcel holding
//! the parcels of its subfolders and a grid for its own files. The islands
//! are then laid out the same way, water between them. Lengths are in
//! tenths of a unit; see [`model::Layout`].

mod treemap;

use model::{AnalysisResult, Grids, Layout, Lots, ParcelNature, Parcels, Rects, Scope};

use crate::files::Language;
pub use treemap::{Audit, AuditLevel};
use treemap::{Gap, LOT, Node};

/// Space between the content of an island and the edge of its plateau.
const ISLAND_MARGIN: u32 = 9;
/// Space between the edge of a parcel and what it holds.
const PARCEL_PADDING: u32 = 3;
/// Parcels this many folders below their island or deeper hold their
/// content without padding: a chain of thousands of nested folders would
/// otherwise grow the city by 0.6 u a level.
const PADDED_LEVELS: u32 = 8;
/// The layout recurses once a folder level, building and dropping its tree:
/// paths thousands of folders deep need more than a thread's usual stack.
/// Reserved, not committed, memory.
const LAYOUT_STACK: usize = 256 * 1024 * 1024;
/// The smallest plateau, whichever way it is turned.
const MIN_PLATEAU: (u32, u32) = (100, 66);
/// The smallest island, as a share of the largest one's area.
const ISLAND_FLOOR: f64 = 0.01;
/// How much wider than tall the archipelago, the inside of an island and
/// a parcel are laid out.
const ARCHIPELAGO_ASPECT: f64 = 1.6;
const ISLAND_ASPECT: f64 = 1.3;
const PARCEL_ASPECT: f64 = 1.0;

/// Space between two neighbours inside an island, by their depth below it:
/// a canal between the folders of the island, a street one level down,
/// then a lane.
fn gap(level: u32) -> u32 {
    match level {
        0 | 1 => 18,
        2 => 9,
        _ => 4,
    }
}

/// Share of a grid's lots left empty, for trees.
fn empty_share(nature: ParcelNature) -> f64 {
    match nature {
        ParcelNature::Normal => 0.13,
        ParcelNature::Tests => 0.5,
        ParcelNature::Unanalyzed => 0.05,
    }
}

/// Lots for `files` files, with room for the empty ones.
fn lots_for(files: u32, nature: ParcelNature) -> u32 {
    let share = empty_share(nature);
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let empty = (f64::from(files) * share / (1.0 - share)).round() as u32;
    files + empty
}

/// What the layout needs to know about the repository.
pub(crate) struct Input<'a> {
    /// The parent of each folder, each folder after its parent.
    pub parents: &'a [Option<u32>],
    pub dir_paths: &'a [&'a str],
    /// The island of each folder's own files.
    pub dir_islands: &'a [Option<u32>],
    /// The folder each island is named after.
    pub island_dirs: &'a [u32],
    /// The folder of each file; files sorted by path.
    pub file_dirs: &'a [u32],
    pub scopes: &'a [Scope],
    /// Whether the analyzer reads the file's language.
    pub analyzed: &'a [bool],
}

/// Counts of files, to tell a parcel's nature.
#[derive(Debug, Clone, Copy, Default)]
struct Counts {
    files: u32,
    tests: u32,
    unanalyzed: u32,
}

impl Counts {
    fn add(&mut self, other: Self) {
        self.files += other.files;
        self.tests += other.tests;
        self.unanalyzed += other.unanalyzed;
    }

    /// What more than half of the files are.
    fn nature(self) -> ParcelNature {
        if self.tests * 2 > self.files {
            ParcelNature::Tests
        } else if self.unanalyzed * 2 > self.files {
            ParcelNature::Unanalyzed
        } else {
            ParcelNature::Normal
        }
    }
}

struct Tree {
    /// Subfolders of each folder in the same island, in folder order.
    children: Vec<Vec<u32>>,
    own: Vec<Counts>,
    below: Vec<Counts>,
}

impl Tree {
    /// The content of `dir`, `level` folders below its island's: the grid
    /// of its own files and the parcels of its subfolders.
    fn content(&self, dir: u32, level: u32) -> Node {
        let own = self.own[dir as usize];
        let mut items = Vec::new();
        if own.files > 0 {
            items.push(Node::grid(dir, lots_for(own.files, own.nature())));
        }
        for &child in &self.children[dir as usize] {
            if self.below[child as usize].files > 0 {
                let content = self.content(child, level + 1);
                let padding = if level + 1 < PADDED_LEVELS {
                    PARCEL_PADDING
                } else {
                    0
                };
                items.push(Node::frame(child, padding, true, content, (0, 0)));
            }
        }
        let aspect = if level == 0 {
            ISLAND_ASPECT
        } else {
            PARCEL_ASPECT
        };
        Node::pack(dir, items, aspect, Gap::Fixed(gap(level + 1)))
    }
}

/// Lays a result out again, from its folders, islands and files, as the
/// analysis did: to time the layout on its own. The result must be valid
/// (`AnalysisResult::validate`): its indexes are trusted.
pub fn of_result(result: &AnalysisResult) -> Layout {
    audited(result).0
}

/// Lays a result out again, as [`of_result`] does, and says where its area
/// went.
pub fn audited(result: &AnalysisResult) -> (Layout, Audit) {
    let dirs = &result.dirs;
    let mut paths: Vec<String> = Vec::with_capacity(dirs.parent.len());
    for (parent, name) in dirs.parent.iter().zip(&dirs.name) {
        let path = match parent {
            Some(parent) if *parent != 0 => format!("{}/{name}", paths[*parent as usize]),
            _ => name.clone(),
        };
        paths.push(path);
    }
    let dir_paths: Vec<&str> = paths.iter().map(String::as_str).collect();
    let analyzed: Vec<bool> = result
        .files
        .language
        .iter()
        .map(|&language| Language::analyzed_named(&result.languages[language as usize]).is_some())
        .collect();
    layout_audited(&Input {
        parents: &dirs.parent,
        dir_paths: &dir_paths,
        dir_islands: &dirs.island,
        island_dirs: &result.islands.dir,
        file_dirs: &result.files.dir,
        scopes: &result.files.scope,
        analyzed: &analyzed,
    })
}

/// Lays the city out, on a thread of its own with room for deep folders.
pub(crate) fn layout(input: &Input) -> Layout {
    layout_audited(input).0
}

fn layout_audited(input: &Input) -> (Layout, Audit) {
    std::thread::scope(|scope| {
        let spawned = std::thread::Builder::new()
            .stack_size(LAYOUT_STACK)
            .spawn_scoped(scope, || layout_here(input));
        match spawned {
            Ok(handle) => handle
                .join()
                .unwrap_or_else(|panic| std::panic::resume_unwind(panic)),
            // No thread to be had: lay it out here, which holds all but extreme depths.
            Err(_) => layout_here(input),
        }
    })
}

fn layout_here(input: &Input) -> (Layout, Audit) {
    let dir_count = input.parents.len();
    let mut own = vec![Counts::default(); dir_count];
    let mut files_of: Vec<Vec<u32>> = vec![Vec::new(); dir_count];
    for (file, &dir) in input.file_dirs.iter().enumerate() {
        let counts = &mut own[dir as usize];
        counts.files += 1;
        counts.tests += u32::from(matches!(input.scopes[file], Scope::Test | Scope::Fixture));
        counts.unanalyzed += u32::from(!input.analyzed[file]);
        files_of[dir as usize].push(crate::saturating_u32(file));
    }
    // Only within an island: an island's folder is not part of its parent
    let mut below = own.clone();
    let mut children: Vec<Vec<u32>> = vec![Vec::new(); dir_count];
    for dir in (1..dir_count).rev() {
        let Some(parent) = input.parents[dir] else {
            continue;
        };
        let island = input.dir_islands[dir];
        if island.is_some() && input.dir_islands[parent as usize] == island {
            let counts = below[dir];
            below[parent as usize].add(counts);
            children[parent as usize].push(crate::saturating_u32(dir));
        }
    }
    for list in &mut children {
        list.reverse();
    }
    let tree = Tree {
        children,
        own,
        below,
    };

    let contents: Vec<Node> = input
        .island_dirs
        .iter()
        .map(|&dir| tree.content(dir, 0))
        .collect();
    let largest = contents.iter().map(plateau_area).fold(0.0f64, f64::max);
    let islands: Vec<Node> = contents
        .into_iter()
        .zip(0..)
        .map(|(content, island)| {
            let min = island_min(&content, largest * ISLAND_FLOOR);
            Node::frame(island, ISLAND_MARGIN, false, content, min)
        })
        .collect();
    let city = Node::pack(u32::MAX, islands, ARCHIPELAGO_ASPECT, Gap::Channel);
    let placed = city.place();

    // Islands are the frames that do not stretch, named by their row;
    // parcels are named by their folder
    let mut plateaux = vec![treemap::Rect::default(); input.island_dirs.len()];
    let mut parcels: Vec<(u32, treemap::Rect)> = Vec::new();
    for &(id, rect, stretch) in &placed.frames {
        if stretch {
            parcels.push((id, rect));
        } else {
            plateaux[id as usize] = rect;
        }
    }
    parcels.sort_by_key(|&(dir, _)| dir);
    let mut grids = placed.grids.clone();
    grids.sort_by_key(|grid| grid.0);

    let mut layout = Layout {
        width: city.width(),
        height: city.height(),
        islands: Rects::default(),
        parcels: Parcels::default(),
        grids: Grids::default(),
        lots: Lots {
            x: vec![0; input.file_dirs.len()],
            y: vec![0; input.file_dirs.len()],
        },
    };
    for rect in &plateaux {
        layout.islands.x.push(rect.x);
        layout.islands.y.push(rect.y);
        layout.islands.width.push(rect.width);
        layout.islands.height.push(rect.height);
    }
    for (dir, rect) in parcels {
        layout.parcels.dir.push(dir);
        layout.parcels.x.push(rect.x);
        layout.parcels.y.push(rect.y);
        layout.parcels.width.push(rect.width);
        layout.parcels.height.push(rect.height);
        layout
            .parcels
            .nature
            .push(tree.below[dir as usize].nature());
    }
    for &(dir, x, y, columns, rows) in &grids {
        layout.grids.dir.push(dir);
        layout.grids.x.push(x);
        layout.grids.y.push(y);
        layout.grids.columns.push(columns);
        layout.grids.rows.push(rows);
        layout.grids.nature.push(tree.own[dir as usize].nature());
        let files = &files_of[dir as usize];
        let lots = lots_of(input, dir, files, columns, rows);
        for (&file, lot) in files.iter().zip(lots) {
            let (column, row) = (lot % columns, lot / columns);
            layout.lots.x[file as usize] = x + column * LOT + LOT / 2;
            layout.lots.y[file as usize] = y + (rows - 1 - row) * LOT + LOT / 2;
        }
    }
    (layout, placed.audit)
}

/// The plateau area of an island holding `content`.
fn plateau_area(content: &Node) -> f64 {
    let (width, height) = plateau_size(content);
    f64::from(width) * f64::from(height)
}

fn plateau_size(content: &Node) -> (u32, u32) {
    (
        content.width() + 2 * ISLAND_MARGIN,
        content.height() + 2 * ISLAND_MARGIN,
    )
}

/// The smallest plateau for `content`: the minimum plateau turned the way
/// the content is, grown to `floor` in area.
fn island_min(content: &Node, floor: f64) -> (u32, u32) {
    let (width, height) = plateau_size(content);
    let min = if width >= height {
        MIN_PLATEAU
    } else {
        (MIN_PLATEAU.1, MIN_PLATEAU.0)
    };
    let area = f64::from(width) * f64::from(height);
    if area > 0.0 && area < floor {
        let scale = (floor / area).sqrt();
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let grown = (
            (f64::from(width) * scale).ceil() as u32,
            (f64::from(height) * scale).ceil() as u32,
        );
        (min.0.max(grown.0), min.1.max(grown.1))
    } else {
        min
    }
}

/// The lot of each of `files`, the files of `dir` in path order, on a grid
/// of `columns` × `rows`, lots counted row by row from the north-west.
/// Config files come first, then the others; the empty lots are scattered
/// among the rest, the same for the same folder.
fn lots_of(input: &Input, dir: u32, files: &[u32], columns: u32, rows: u32) -> Vec<u32> {
    let total = columns * rows;
    let count = crate::saturating_u32(files.len());
    let configs = crate::saturating_u32(
        files
            .iter()
            .filter(|&&file| input.scopes[file as usize] == Scope::Config)
            .count(),
    );
    let path = input.dir_paths[dir as usize];
    let mut free: Vec<u32> = (configs..total).collect();
    free.sort_by_key(|&lot| (hash(path, lot), lot));
    let mut empty = vec![false; total as usize];
    let empties = free.len().min(total.saturating_sub(count) as usize);
    for &lot in &free[..empties] {
        empty[lot as usize] = true;
    }
    let mut taken = (0..total).filter(|&lot| !empty[lot as usize]);
    let mut lots = vec![0; files.len()];
    let order = files
        .iter()
        .enumerate()
        .filter(|&(_, &file)| input.scopes[file as usize] == Scope::Config)
        .chain(
            files
                .iter()
                .enumerate()
                .filter(|&(_, &file)| input.scopes[file as usize] != Scope::Config),
        );
    for (index, _) in order {
        lots[index] = taken.next().unwrap_or(0);
    }
    lots
}

/// FNV-1a over a folder's path and a lot: stable across runs and builds,
/// unlike the standard hasher.
fn hash(path: &str, lot: u32) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in path.bytes().chain(lot.to_le_bytes()) {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    hash
}
