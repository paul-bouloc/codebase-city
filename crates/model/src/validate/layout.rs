//! Checks on the layout of a result: where islands, parcels, grids and
//! lots lie.

use std::collections::{BTreeMap, HashSet};

use super::{InvalidResult, in_bounds, same_length};
use crate::result::AnalysisResult;

/// A rectangle, in tenths of a unit.
#[derive(Debug, Clone, Copy)]
struct Rect {
    x: u64,
    y: u64,
    width: u64,
    height: u64,
}

impl Rect {
    fn new(x: u32, y: u32, width: u32, height: u32) -> Self {
        Self {
            x: x.into(),
            y: y.into(),
            width: width.into(),
            height: height.into(),
        }
    }

    fn contains(self, other: Self) -> bool {
        other.width > 0
            && other.height > 0
            && other.x >= self.x
            && other.y >= self.y
            && other.x + other.width <= self.x + self.width
            && other.y + other.height <= self.y + self.height
    }

    fn overlaps(self, other: Self) -> bool {
        self.x < other.x + other.width
            && other.x < self.x + self.width
            && self.y < other.y + other.height
            && other.y < self.y + self.height
    }
}

/// Lots are 2 × 2 u, in tenths.
const LOT: u64 = 20;
/// A city of n files spans at most (n + 16) × 1,000 u², in tenths: the layout gives about 20 to
/// 60 u² a file, a minimal island 66 u².
const MAX_AREA_PER_FILE: u64 = 100_000;
const SLACK_FILES: u64 = 16;
/// At most 8 lots a file, and 256 more: the layout leaves about 2.
const MAX_LOTS_PER_FILE: u64 = 8;
const SLACK_LOTS: u64 = 256;

/// Islands lie in the city, parcels and grids in their island or parent
/// parcel without overlapping, and each file on a lot of its folder's grid.
pub(super) fn layout(result: &AnalysisResult) -> Result<(), InvalidResult> {
    let (dirs, layout) = (&result.dirs, &result.layout);
    let dir_count = dirs.parent.len();
    let island_count = result.islands.dir.len();
    let plateaux = &layout.islands;
    same_length("layout.islands.x", island_count, plateaux.x.len())?;
    same_length("layout.islands.y", island_count, plateaux.y.len())?;
    same_length("layout.islands.width", island_count, plateaux.width.len())?;
    same_length("layout.islands.height", island_count, plateaux.height.len())?;
    let parcels = &layout.parcels;
    let parcel_count = parcels.dir.len();
    same_length("layout.parcels.x", parcel_count, parcels.x.len())?;
    same_length("layout.parcels.y", parcel_count, parcels.y.len())?;
    same_length("layout.parcels.width", parcel_count, parcels.width.len())?;
    same_length("layout.parcels.height", parcel_count, parcels.height.len())?;
    same_length("layout.parcels.nature", parcel_count, parcels.nature.len())?;
    in_bounds("layout.parcels.dir", &parcels.dir, dir_count)?;
    let grids = &layout.grids;
    let grid_count = grids.dir.len();
    same_length("layout.grids.x", grid_count, grids.x.len())?;
    same_length("layout.grids.y", grid_count, grids.y.len())?;
    same_length("layout.grids.columns", grid_count, grids.columns.len())?;
    same_length("layout.grids.rows", grid_count, grids.rows.len())?;
    same_length("layout.grids.nature", grid_count, grids.nature.len())?;
    in_bounds("layout.grids.dir", &grids.dir, dir_count)?;
    let file_count = result.files.dir.len();
    same_length("layout.lots.x", file_count, layout.lots.x.len())?;
    same_length("layout.lots.y", file_count, layout.lots.y.len())?;
    for (table, column) in [
        ("layout.parcels", &parcels.dir),
        ("layout.grids", &grids.dir),
    ] {
        if let Some(row) = column.windows(2).position(|pair| pair[0] >= pair[1]) {
            return Err(InvalidResult::LayoutOrder {
                table,
                row: row + 1,
            });
        }
    }

    let mut own = vec![0u64; dir_count];
    for &dir in &result.files.dir {
        own[dir as usize] += 1;
    }
    let mut below = own.clone();
    for dir in (1..dir_count).rev() {
        if let Some(parent) = dirs.parent[dir] {
            below[parent as usize] += below[dir];
        }
    }

    let city = Rect::new(0, 0, layout.width, layout.height);
    // However it came, a layout stays in proportion to its files: a browser draws every lot and
    // every metre of shore of it.
    let files = file_count as u64;
    if city.width * city.height > (files + SLACK_FILES) * MAX_AREA_PER_FILE {
        return Err(InvalidResult::LayoutTooLarge {
            what: "layout.width and layout.height",
        });
    }
    let lots = grids
        .columns
        .iter()
        .zip(&grids.rows)
        .fold(0u64, |sum, (&columns, &rows)| {
            sum.saturating_add(u64::from(columns) * u64::from(rows))
        });
    if lots > MAX_LOTS_PER_FILE * files + SLACK_LOTS {
        return Err(InvalidResult::LayoutTooLarge {
            what: "layout.grids",
        });
    }
    let plateau = |island: usize| {
        Rect::new(
            plateaux.x[island],
            plateaux.y[island],
            plateaux.width[island],
            plateaux.height[island],
        )
    };
    let parcel = |row: usize| {
        Rect::new(
            parcels.x[row],
            parcels.y[row],
            parcels.width[row],
            parcels.height[row],
        )
    };
    let parcel_of = |dir: u32| parcels.dir.binary_search(&dir).ok();
    // The rectangles that share a container: the islands of the city, or
    // what holds a folder's content
    let mut groups: BTreeMap<Option<u32>, Vec<(&'static str, usize, Rect)>> = BTreeMap::new();
    for island in 0..island_count {
        if !city.contains(plateau(island)) {
            return Err(InvalidResult::LayoutOutside {
                table: "layout.islands",
                row: island,
            });
        }
        groups
            .entry(None)
            .or_default()
            .push(("layout.islands", island, plateau(island)));
    }
    // The plateau of the island a folder is named after, or its parcel
    let container = |dir: u32| -> Option<Rect> {
        let island = dirs.island[dir as usize]? as usize;
        if result.islands.dir[island] == dir {
            Some(plateau(island))
        } else {
            parcel_of(dir).map(parcel)
        }
    };
    for (row, &dir) in parcels.dir.iter().enumerate() {
        let island = dirs.island[dir as usize];
        let parent = dirs.parent[dir as usize];
        let valid = below[dir as usize] > 0
            && island.is_some_and(|island| result.islands.dir[island as usize] != dir);
        let Some((parent, outer)) = parent
            .filter(|_| valid)
            .and_then(|parent| Some((parent, container(parent)?)))
        else {
            return Err(InvalidResult::ParcelDir { row });
        };
        if !outer.contains(parcel(row)) {
            return Err(InvalidResult::LayoutOutside {
                table: "layout.parcels",
                row,
            });
        }
        groups
            .entry(Some(parent))
            .or_default()
            .push(("layout.parcels", row, parcel(row)));
    }
    for (row, &dir) in grids.dir.iter().enumerate() {
        let Some(outer) = container(dir).filter(|_| own[dir as usize] > 0) else {
            return Err(InvalidResult::GridDir { row });
        };
        // In u64: a saturated size would let a huge grid pass for a smaller one.
        let rect = Rect {
            x: grids.x[row].into(),
            y: grids.y[row].into(),
            width: u64::from(grids.columns[row]) * LOT,
            height: u64::from(grids.rows[row]) * LOT,
        };
        if !outer.contains(rect) {
            return Err(InvalidResult::LayoutOutside {
                table: "layout.grids",
                row,
            });
        }
        groups
            .entry(Some(dir))
            .or_default()
            .push(("layout.grids", row, rect));
    }
    for mut group in groups.into_values() {
        group.sort_by_key(|(_, _, rect)| rect.x);
        for (index, &(_, _, rect)) in group.iter().enumerate() {
            let later = group[index + 1..]
                .iter()
                .take_while(|(_, _, other)| other.x < rect.x + rect.width);
            if let Some(&(table, row, _)) = later
                .into_iter()
                .find(|(_, _, other)| rect.overlaps(*other))
            {
                return Err(InvalidResult::LayoutOverlap { table, row });
            }
        }
    }

    let mut taken = HashSet::with_capacity(file_count);
    for (row, &dir) in result.files.dir.iter().enumerate() {
        let (x, y) = (u64::from(layout.lots.x[row]), u64::from(layout.lots.y[row]));
        let on_grid = grids.dir.binary_search(&dir).is_ok_and(|grid| {
            let on_axis = |at: u64, start: u32, count: u32| {
                let offset = at.checked_sub(u64::from(start) + LOT / 2);
                offset.is_some_and(|offset| offset % LOT == 0 && offset / LOT < u64::from(count))
            };
            on_axis(x, grids.x[grid], grids.columns[grid])
                && on_axis(y, grids.y[grid], grids.rows[grid])
        });
        if !on_grid {
            return Err(InvalidResult::LotOutside { row });
        }
        if !taken.insert((x, y)) {
            return Err(InvalidResult::LotShared { row });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::result::{Grids, ParcelNature, Parcels};
    use crate::validate::tests::{invalid, result};

    /// [`result`] with `src/lib` (folder 2) in the `src` island: its own
    /// parcel, a grid for `util.ts`, moved there, and room for a sibling.
    fn with_parcel() -> AnalysisResult {
        let mut result = result();
        result.dirs.parent.push(Some(1));
        result.dirs.name.push("lib".to_owned());
        result.dirs.island.push(Some(1));
        result.files.dir[1] = 2;
        result.layout.parcels = Parcels {
            dir: vec![2],
            x: vec![250],
            y: vec![6],
            width: vec![26],
            height: vec![26],
            nature: vec![ParcelNature::Normal],
        };
        result.layout.grids = Grids {
            dir: vec![1, 2],
            x: vec![209, 253],
            y: vec![9, 9],
            columns: vec![1, 1],
            rows: vec![1, 1],
            nature: vec![ParcelNature::Normal; 2],
        };
        result.layout.lots.x = vec![219, 263];
        result
    }

    fn invalid_parcel(change: impl FnOnce(&mut AnalysisResult)) -> InvalidResult {
        let mut result = with_parcel();
        change(&mut result);
        result.validate().unwrap_err()
    }

    #[test]
    fn a_layout_has_a_plateau_per_island_and_a_lot_per_file() {
        assert_eq!(with_parcel().validate(), Ok(()));
        assert_eq!(
            invalid(|r| {
                r.layout.islands.width.pop();
            }),
            InvalidResult::ColumnLength {
                column: "layout.islands.width",
                expected: 2,
                actual: 1,
            }
        );
        assert_eq!(
            invalid(|r| {
                r.layout.lots.y.pop();
            }),
            InvalidResult::ColumnLength {
                column: "layout.lots.y",
                expected: 2,
                actual: 1,
            }
        );
    }

    #[test]
    fn a_layout_stays_in_proportion_to_its_files() {
        assert_eq!(
            invalid(|r| {
                r.layout.width = u32::MAX;
                r.layout.height = u32::MAX;
            }),
            InvalidResult::LayoutTooLarge {
                what: "layout.width and layout.height"
            }
        );
        assert_eq!(
            invalid(|r| r.layout.grids.rows[0] = 100_000),
            InvalidResult::LayoutTooLarge {
                what: "layout.grids"
            }
        );
    }

    #[test]
    fn islands_lie_apart_in_the_city() {
        assert_eq!(
            invalid(|r| r.layout.width = 299),
            InvalidResult::LayoutOutside {
                table: "layout.islands",
                row: 1,
            }
        );
        assert_eq!(
            invalid(|r| r.layout.islands.height[0] = 0),
            InvalidResult::LayoutOutside {
                table: "layout.islands",
                row: 0,
            }
        );
        assert_eq!(
            invalid(|r| r.layout.islands.x[0] = 150),
            InvalidResult::LayoutOverlap {
                table: "layout.islands",
                row: 1,
            }
        );
    }

    #[test]
    fn a_parcel_belongs_to_a_folder_below_its_island() {
        // `src` is the island's own folder
        assert_eq!(
            invalid_parcel(|r| r.layout.parcels.dir[0] = 1),
            InvalidResult::ParcelDir { row: 0 }
        );
        // A folder without files
        assert_eq!(
            invalid_parcel(|r| {
                r.files.dir[1] = 1;
                r.layout.grids = Grids {
                    dir: vec![1],
                    x: vec![209],
                    y: vec![9],
                    columns: vec![2],
                    rows: vec![1],
                    nature: vec![ParcelNature::Normal],
                };
                r.layout.lots.x = vec![219, 239];
            }),
            InvalidResult::ParcelDir { row: 0 }
        );
        assert_eq!(
            invalid_parcel(|r| {
                r.layout.parcels.dir.insert(0, 1);
                r.layout.parcels.x.insert(0, 200);
                r.layout.parcels.y.insert(0, 0);
                r.layout.parcels.width.insert(0, 10);
                r.layout.parcels.height.insert(0, 10);
                r.layout.parcels.nature.insert(0, ParcelNature::Tests);
                r.layout.parcels.dir.swap(0, 1);
            }),
            InvalidResult::LayoutOrder {
                table: "layout.parcels",
                row: 1,
            }
        );
    }

    #[test]
    fn parcels_and_grids_lie_apart_in_their_container() {
        assert_eq!(
            invalid_parcel(|r| r.layout.parcels.x[0] = 290),
            InvalidResult::LayoutOutside {
                table: "layout.parcels",
                row: 0,
            }
        );
        assert_eq!(
            invalid_parcel(|r| r.layout.grids.x[1] = 270),
            InvalidResult::LayoutOutside {
                table: "layout.grids",
                row: 1,
            }
        );
        // Its size in tenths overflows a u32: never mistaken for a smaller one
        assert_eq!(
            invalid_parcel(|r| {
                r.layout.grids.columns[1] = u32::MAX / 10;
                r.layout.grids.rows[1] = 1;
                r.layout.grids.columns[0] = 1;
            }),
            InvalidResult::LayoutTooLarge {
                what: "layout.grids"
            }
        );
        // The grid of `src` and the parcel of `src/lib` share the plateau
        assert_eq!(
            invalid_parcel(|r| {
                r.layout.parcels.x[0] = 220;
                r.layout.grids.x[1] = 223;
                r.layout.lots.x[1] = 233;
            }),
            InvalidResult::LayoutOverlap {
                table: "layout.parcels",
                row: 0,
            }
        );
    }

    #[test]
    fn a_grid_belongs_to_a_folder_with_files() {
        assert_eq!(
            invalid(|r| {
                r.layout.grids.dir.insert(0, 0);
                r.layout.grids.x.insert(0, 9);
                r.layout.grids.y.insert(0, 9);
                r.layout.grids.columns.insert(0, 1);
                r.layout.grids.rows.insert(0, 1);
                r.layout.grids.nature.insert(0, ParcelNature::Normal);
            }),
            InvalidResult::GridDir { row: 0 }
        );
        assert_eq!(
            invalid(|r| {
                r.layout.grids.nature.pop();
            }),
            InvalidResult::ColumnLength {
                column: "layout.grids.nature",
                expected: 1,
                actual: 0,
            }
        );
        assert_eq!(
            invalid(|r| r.layout.grids.rows[0] = 0),
            InvalidResult::LayoutOutside {
                table: "layout.grids",
                row: 0,
            }
        );
    }

    #[test]
    fn each_file_has_a_lot_of_its_own_on_its_grid() {
        assert_eq!(
            invalid(|r| r.layout.lots.x[1] = 259),
            InvalidResult::LotOutside { row: 1 }
        );
        assert_eq!(
            invalid(|r| r.layout.lots.x[1] = 229),
            InvalidResult::LotOutside { row: 1 }
        );
        assert_eq!(
            invalid(|r| r.layout.lots.y[0] = 9),
            InvalidResult::LotOutside { row: 0 }
        );
        assert_eq!(
            invalid(|r| r.layout.lots.x[1] = 219),
            InvalidResult::LotShared { row: 1 }
        );
        // `src` without a grid
        assert_eq!(
            invalid(|r| r.layout.grids = Grids::default()),
            InvalidResult::LotOutside { row: 0 }
        );
    }
}
