//! Laying a pack's items out in rows: which items share a row, and the
//! shape each one takes to match its height.

use super::{Axis, Gap, Kind, LOT, MAX_STRETCH, Node, PackShape, Shape, item_side};

/// How many times a row's height is corrected to make it as wide as its
/// pack.
const ROW_FITS: usize = 4;

/// The worst aspect ratio a last row keeps before it joins the row above.
const LAST_ROW_RATIO: f64 = 3.0;

/// The fewest and the most rows a grid of `lots` lots can have without
/// being longer than [`MAX_STRETCH`] times its width either way.
fn compact_rows(lots: u32) -> (u32, u32) {
    let fewest = (1..=lots)
        .find(|&rows| lots.div_ceil(rows) <= MAX_STRETCH * rows)
        .unwrap_or(1);
    // rows ≤ 4 ⌈lots ÷ rows⌉ < 4 (lots ÷ rows + 1) bounds rows by 2 + 2 √(1 + lots)
    let bound = lots.min(3 + 2 * (lots + 1).isqrt());
    let most = (1..=bound)
        .rev()
        .find(|&rows| rows <= MAX_STRETCH * lots.div_ceil(rows))
        .unwrap_or(lots);
    (fewest, most)
}

/// A row an item is fitted into: its height, how wide the row is, and how
/// wide the item would be in an ideal layout.
struct Row {
    height: u32,
    width: u32,
    expected: u32,
}

impl Row {
    /// The room lost by giving the item a shape of `size`, for an item that
    /// needs `weight`: what the shape wastes itself, what the row or the
    /// item is stretched by when the shape is taller or shorter than the
    /// row, and what the row loses when the shape is wider or narrower than
    /// expected.
    fn waste(&self, (width, height): (u32, u32), weight: u64) -> f64 {
        let (width, height) = (f64::from(width), f64::from(height));
        let (row_width, row_height) = (f64::from(self.width), f64::from(self.height));
        let own = (width * height - weight as f64).max(0.0);
        let vertical = if height <= row_height {
            (row_height - height) * width
        } else {
            (height - row_height) * (row_width - width).max(0.0)
        };
        let horizontal = (width - f64::from(self.expected)).abs() * row_height;
        own + vertical + horizontal
    }
}

impl Node {
    /// The shape that wastes the least room in a row: see [`Row::waste`].
    fn fit(&self, row: &Row) -> u32 {
        // A shape goes through every frame to what they hold: a folder of one
        // subfolder and no files of its own is a frame around a frame.
        let (inner, padding) = self.innermost();
        let candidates: Vec<u32> = match &inner.kind {
            Kind::Grid { lots } => {
                let (fewest, most) = compact_rows(*lots);
                let rows = (row.height.saturating_sub(2 * padding) / LOT).clamp(fewest, most);
                // As many columns, no row more than the lots need
                let tight = lots.div_ceil(lots.div_ceil(rows)).max(fewest);
                vec![rows, (rows + 1).min(most), tight]
            }
            Kind::Pack { shapes, .. } => {
                let all = (0..).take(shapes.len());
                let compact: Vec<u32> = all
                    .clone()
                    .filter(|&choice| {
                        let (width, height) = self.size(choice);
                        width.max(height) <= MAX_STRETCH * width.min(height)
                    })
                    .collect();
                if compact.is_empty() {
                    all.collect()
                } else {
                    compact
                }
            }
            Kind::Frame { .. } => Vec::new(),
        };
        let mut best = (self.preferred(), f64::INFINITY);
        for choice in candidates {
            let waste = row.waste(self.size(choice), self.weight);
            if waste < best.1 {
                best = (choice, waste);
            }
        }
        best.0
    }
}

/// Lays `items`, heaviest first, out in rows about `width` wide, from the
/// north, small items stacked or not: see [`lay_rows`].
pub(super) fn rows(items: &[Node], width: f64, gap: Gap, stack: bool) -> PackShape {
    let order: Vec<usize> = (0..items.len()).collect();
    let mut choices = vec![0; items.len()];
    let rows = lay_rows(items, &order, width, gap, stack, &mut choices);
    let size_of = |index: usize| items[index].size(choices[index]);
    let (width, height) = rows.size(&size_of);
    PackShape {
        rows,
        choices,
        width,
        height,
    }
}

/// Lays the items of `order`, heaviest first, out in rows about `width`
/// wide, from the north, and writes the shape each one takes in `choices`.
/// A row takes items while that makes its worst item squarer, as the
/// squarified treemap does; each item then takes the shape closest to the
/// row's height. With `stack`, the items much smaller than their row may
/// share one place in it: see [`stacked_row`].
fn lay_rows(
    items: &[Node],
    order: &[usize],
    width: f64,
    gap: Gap,
    stack: bool,
    choices: &mut [u32],
) -> Shape {
    let weights: Vec<f64> = order
        .iter()
        .map(|&index| items[index].weight as f64)
        .collect();
    let mut ranges: Vec<std::ops::Range<usize>> = Vec::new();
    let mut start = 0;
    while start < order.len() {
        let mut end = start + 1;
        let mut worst = row_ratio(&weights[start..end], width, gap);
        while end < order.len() {
            let next = row_ratio(&weights[start..=end], width, gap);
            if next > worst {
                break;
            }
            worst = next;
            end += 1;
        }
        ranges.push(start..end);
        start = end;
    }
    // The last items may be too few to fill a row: a thin strip across the
    // whole width. They join the row before when that is squarer
    while ranges.len() > 1 {
        let last = ranges[ranges.len() - 1].clone();
        let before = ranges[ranges.len() - 2].clone();
        let alone = row_ratio(&weights[last.clone()], width, gap);
        let merged = row_ratio(&weights[before.start..last.end], width, gap);
        if alone <= LAST_ROW_RATIO || merged >= alone {
            break;
        }
        ranges.pop();
        if let Some(previous) = ranges.last_mut() {
            previous.end = last.end;
        }
    }

    let mut rows: Vec<Shape> = Vec::with_capacity(ranges.len());
    for range in ranges {
        let members = &order[range.clone()];
        let height = fit_row(items, members, &weights[range], width, gap, choices);
        let stacked = if stack {
            stacked_row(items, members, (width, height), gap, choices)
        } else {
            None
        };
        rows.push(stacked.unwrap_or_else(|| {
            let children = members.iter().map(|&index| Shape::Item(index)).collect();
            side_by_side(items, children, gap, choices)
        }));
    }
    let size_of = |index: usize| items[index].size(choices[index]);
    if rows.len() == 1 {
        return rows.pop().unwrap_or(Shape::Item(order[0]));
    }
    let gaps = rows
        .windows(2)
        .map(|pair| {
            gap.between(
                pair[0]
                    .extent(&size_of, Axis::X)
                    .min(pair[1].extent(&size_of, Axis::X)),
            )
        })
        .collect();
    Shape::split(&size_of, Axis::Y, gaps, rows)
}

/// Fits the items of a row to its height, and returns that height. Shapes
/// come in steps: the row may come out wider than the pack, and a taller
/// row makes narrower items.
fn fit_row(
    items: &[Node],
    members: &[usize],
    weights: &[f64],
    width: f64,
    gap: Gap,
    choices: &mut [u32],
) -> f64 {
    let mut height = row_height(weights, width, gap);
    for fit in 1..=ROW_FITS {
        for (&index, &weight) in members.iter().zip(weights) {
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let row = Row {
                height: height.round() as u32,
                width: width.round() as u32,
                expected: (weight / height.max(1.0)).round() as u32,
            };
            choices[index] = items[index].fit(&row);
        }
        let children = members.iter().map(|&index| Shape::Item(index)).collect();
        let built = side_by_side(items, children, gap, choices);
        let size_of = |index: usize| items[index].size(choices[index]);
        // A row too narrow is stretched over: flattening it would make
        // thin strips
        let ratio = f64::from(built.extent(&size_of, Axis::X)) / width.max(1.0);
        // The last fit stands: the height returned is the one the items took
        if ratio < 1.03 || fit == ROW_FITS {
            break;
        }
        height *= ratio;
    }
    height
}

/// `children` side by side, west to east.
fn side_by_side(items: &[Node], mut children: Vec<Shape>, gap: Gap, choices: &[u32]) -> Shape {
    let size_of = |index: usize| items[index].size(choices[index]);
    if children.len() == 1 {
        return children.pop().unwrap_or(Shape::Item(0));
    }
    let gaps = children
        .windows(2)
        .map(|pair| {
            gap.between(
                pair[0]
                    .extent(&size_of, Axis::Y)
                    .min(pair[1].extent(&size_of, Axis::Y)),
            )
        })
        .collect();
    Shape::split(&size_of, Axis::X, gaps, children)
}

/// How wide, against the area its items need, the stack at the end of a
/// row is first tried: narrower stacks are taller.
const STACK_WIDTHS: [f64; 4] = [0.8, 1.0, 1.25, 1.6];

/// The row of `members`, `height` tall, with its smallest items stacked in
/// rows of their own in a single place at its east end, when that loses
/// less room than leaving each one alone across the whole height. A small
/// folder beside a large one then keeps a square shape instead of a tall
/// strip, or a grid of empty lots. `None` when stacking gains nothing.
fn stacked_row(
    items: &[Node],
    members: &[usize],
    (width, height): (f64, f64),
    gap: Gap,
    choices: &mut [u32],
) -> Option<Shape> {
    // Heaviest first: the small items are the last ones
    let first = members
        .iter()
        .position(|&index| (items[index].weight as f64).sqrt() * 2.0 <= height)?;
    let (large, small) = members.split_at(first);
    if small.len() < 2 {
        return None;
    }
    let need: f64 = small.iter().map(|&index| items[index].weight as f64).sum();
    // The room the stack needs, gaps included: between islands, a channel is
    // as wide as a small island
    let room: f64 = small
        .iter()
        .map(|&index| {
            let side = (items[index].weight as f64).sqrt();
            let gap = f64::from(gap.between(item_side(&items[index])));
            (side + gap) * (side + gap)
        })
        .sum();
    let alone: Vec<u32> = small.iter().map(|&index| choices[index]).collect();
    let extent = |choices: &[u32], indexes: &[usize], axis: Axis| -> f64 {
        let size_of = |index: usize| items[index].size(choices[index]);
        let children = indexes.iter().map(|&index| Shape::Item(index)).collect();
        f64::from(side_by_side(items, children, gap, choices).extent(&size_of, axis))
    };
    let large_width = if large.is_empty() {
        0.0
    } else {
        extent(choices, large, Axis::X)
    };
    // A row narrower than the pack leaves room beside it
    let between = if large.is_empty() {
        0.0
    } else {
        f64::from(gap.between(LOT))
    };
    let beside = |small_width: f64, row_height: f64| {
        (width - large_width - between - small_width).max(0.0) * row_height
    };
    // Alone, each small item takes the whole height of the row
    let alone_width = extent(choices, small, Axis::X);
    let mut best = (
        alone_width * height - need + beside(alone_width, height),
        None,
    );
    let area = if gap == Gap::Channel { room } else { need };
    for factor in STACK_WIDTHS {
        let stack_width = (area / height.max(1.0) * factor).max(f64::from(LOT));
        let stack = lay_rows(items, small, stack_width, gap, false, choices);
        let size_of = |index: usize| items[index].size(choices[index]);
        let (stack_width, stack_height) = stack.size(&size_of);
        let (stack_width, stack_height) = (f64::from(stack_width), f64::from(stack_height));
        // A stack taller than the row makes the whole row taller
        let cost = stack_width * stack_height.max(height) - need
            + (stack_height - height).max(0.0) * large_width
            + beside(stack_width, stack_height.max(height));
        if cost < best.0 {
            let taken = small
                .iter()
                .map(|&index| choices[index])
                .collect::<Vec<_>>();
            best = (cost, Some((stack, taken)));
        }
    }
    let Some((stack, taken)) = best.1 else {
        for (&index, choice) in small.iter().zip(alone) {
            choices[index] = choice;
        }
        return None;
    };
    for (&index, choice) in small.iter().zip(taken) {
        choices[index] = choice;
    }
    let mut children: Vec<Shape> = large.iter().map(|&index| Shape::Item(index)).collect();
    children.push(stack);
    Some(side_by_side(items, children, gap, choices))
}

/// The height of a row of items of `weights` across `width`, gaps between
/// them left out.
fn row_height(weights: &[f64], width: f64, gap: Gap) -> f64 {
    let sum: f64 = weights.iter().sum();
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let typical = (sum / weights.len() as f64).sqrt() as u32;
    let gaps = f64::from(gap.between(typical)) * (weights.len() - 1) as f64;
    sum / (width - gaps).max(f64::from(LOT))
}

/// The worst aspect ratio of the items of a row.
fn row_ratio(weights: &[f64], width: f64, gap: Gap) -> f64 {
    let height = row_height(weights, width, gap);
    let height2 = height * height;
    weights
        .iter()
        .map(|&weight| (weight / height2).max(height2 / weight.max(1.0)))
        .fold(0.0, f64::max)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::treemap::tests::parcels;

    /// A row `height` high for an item that would ideally be `expected`
    /// wide, in a row ten times wider.
    fn row(height: u32, expected: u32) -> Row {
        Row {
            height,
            width: 10 * expected,
            expected,
        }
    }

    #[test]
    fn a_grid_fits_a_row_with_room_for_its_lots() {
        let grid = Node::grid(0, 10);
        assert_eq!(
            grid.size(grid.fit(&row(2 * LOT + 5, 5 * LOT))),
            (5 * LOT, 2 * LOT)
        );
        // Never a strip longer than four times its width
        assert_eq!(grid.size(grid.fit(&row(3, 10 * LOT))), (5 * LOT, 2 * LOT));
        assert_eq!(
            grid.size(grid.fit(&row(100 * LOT, LOT))),
            (2 * LOT, 8 * LOT)
        );
    }

    #[test]
    fn a_framed_grid_fits_inside_its_padding() {
        let frame = Node::frame(0, 3, true, Node::grid(1, 6), (0, 0));
        assert_eq!(
            frame.size(frame.fit(&row(3 * LOT + 6, 2 * LOT + 6))),
            (2 * LOT + 6, 3 * LOT + 6)
        );
    }

    #[test]
    fn a_frame_keeps_its_minimum_size() {
        let frame = Node::frame(0, 9, false, Node::grid(1, 1), (100, 66));
        assert_eq!((frame.width(), frame.height()), (100, 66));
        // One row or two make the same height, the minimum: two waste less
        let frame = Node::frame(0, 9, false, Node::grid(1, 12), (100, 66));
        assert_eq!(
            frame.size(frame.fit(&row(10, 12 * LOT))),
            (6 * LOT + 18, 66)
        );
    }

    #[test]
    fn a_pack_has_shapes_from_narrow_to_wide() {
        let pack = Node::pack(9, parcels(), 1.0, Gap::Fixed(9));
        let Kind::Pack { shapes, .. } = &pack.kind else {
            panic!("not a pack");
        };
        let narrowest = shapes.first().unwrap();
        let widest = shapes.last().unwrap();
        assert!(narrowest.width < narrowest.height);
        assert!(widest.width > 2 * widest.height);
        // A row as tall as the narrowest shape gets the tallest one no longer
        // than four times its width
        let (width, height) = pack.size(pack.fit(&row(narrowest.height, narrowest.width)));
        assert!(height > width && height <= MAX_STRETCH * width);
        let tallest = shapes
            .iter()
            .filter(|shape| shape.height <= MAX_STRETCH * shape.width)
            .map(|shape| shape.height)
            .max()
            .unwrap();
        assert_eq!(height, tallest);
    }

    #[test]
    fn a_compact_grid_has_the_rows_a_full_search_finds() {
        for lots in 1..3000u32 {
            let fits = |rows: u32| {
                let columns = lots.div_ceil(rows);
                columns <= MAX_STRETCH * rows && rows <= MAX_STRETCH * columns
            };
            let fewest = (1..=lots).find(|&rows| fits(rows)).unwrap();
            let most = (1..=lots).rev().find(|&rows| fits(rows)).unwrap();
            assert_eq!(compact_rows(lots), (fewest, most), "{lots} lots");
        }
    }

    #[test]
    fn a_row_is_fitted_to_the_height_it_returns() {
        // A row too narrow for its items: every correction runs out
        let items: Vec<Node> = (0..5).map(|id| Node::grid(id, 2 + id)).collect();
        let members: Vec<usize> = (0..items.len()).collect();
        let weights: Vec<f64> = items.iter().map(|item| item.weight as f64).collect();
        let mut choices = vec![0; items.len()];
        let width = f64::from(8 * LOT);
        let height = fit_row(
            &items,
            &members,
            &weights,
            width,
            Gap::Fixed(9),
            &mut choices,
        );
        for (&index, &weight) in members.iter().zip(&weights) {
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let row = Row {
                height: height.round() as u32,
                width: width.round() as u32,
                expected: (weight / height.max(1.0)).round() as u32,
            };
            assert_eq!(
                items[index].fit(&row),
                choices[index],
                "item {index} at {height}"
            );
        }
    }

    #[test]
    fn small_items_beside_a_large_one_are_stacked() {
        let mut items = vec![Node::grid(0, 64)];
        items.extend((1..=6).map(|id| Node::grid(id, 2)));
        let members: Vec<usize> = (0..items.len()).collect();
        let mut choices = vec![0; items.len()];
        let height = f64::from(8 * LOT);
        let weights: Vec<f64> = items.iter().map(|item| item.weight as f64).collect();
        let width = f64::from(16 * LOT);
        fit_row(
            &items,
            &members,
            &weights,
            width,
            Gap::Fixed(9),
            &mut choices,
        );
        let alone = side_by_side(
            &items,
            members.iter().map(|&index| Shape::Item(index)).collect(),
            Gap::Fixed(9),
            &choices,
        );
        let row = stacked_row(
            &items,
            &members,
            (width, height),
            Gap::Fixed(9),
            &mut choices,
        )
        .expect("the small grids are stacked");
        let size_of = |index: usize| items[index].size(choices[index]);
        // The large grid, then one place holding the six small ones in rows
        let Shape::Split { children, .. } = &row else {
            panic!("not a row: {row:?}");
        };
        assert_eq!(children.len(), 2);
        assert!(matches!(children[1], Shape::Split { axis: Axis::Y, .. }));
        assert!(row.extent(&size_of, Axis::X) < alone.extent(&size_of, Axis::X));
    }
}
