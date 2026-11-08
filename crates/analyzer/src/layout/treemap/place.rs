//! Placing a tree: the rectangle of each grid and frame, and, when asked
//! for, where its area went.

use super::{Axis, Kind, LOT, MAX_STRETCH, Node, Rect, Shape, area, area_of};

/// Where the grids and frames of a tree were placed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Placed {
    /// Id, south-west corner, columns and rows.
    pub grids: Vec<(u32, u32, u32, u32, u32)>,
    /// Id, rectangle, and whether the frame stretches.
    pub frames: Vec<(u32, Rect, bool)>,
    /// Where the area went, when asked for: see [`Node::place_audited`].
    pub audit: Option<Audit>,
}

impl Placed {
    /// The audit of `depth`, if the placement is audited.
    fn audit_at(&mut self, depth: usize) -> Option<&mut AuditLevel> {
        self.audit.as_mut().map(|audit| audit.at(depth))
    }
}

/// Where the area of a placed tree went, by depth: the tree's root is at
/// depth 0, and what a frame holds one deeper than the frame. Areas in
/// square tenths of a unit.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Audit {
    pub levels: Vec<AuditLevel>,
}

/// One depth of an [`Audit`]. The first six sum to the area placed at
/// that depth; the last three say where room was lost, and end up as
/// extra lots, larger gaps and frames deeper down.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AuditLevel {
    /// The lots the grids asked for.
    pub lots: u64,
    /// Grid area beyond those lots: more lots, and edges thinner than a lot.
    pub extra_lots: u64,
    /// Space between neighbours.
    pub gaps: u64,
    /// The padding of frames.
    pub padding: u64,
    /// Around frames that keep their own size.
    pub water: u64,
    /// Beside parcels and grids that would be stretched too long.
    pub ground: u64,
    /// Items shorter than their row, across the row.
    pub shorter: u64,
    /// Rows narrower than their pack.
    pub narrower: u64,
    /// Items in a larger shape than their preferred one, or grids with
    /// more lots than asked for; negative when the shapes are smaller.
    pub reshaped: i64,
}

impl Audit {
    fn at(&mut self, depth: usize) -> &mut AuditLevel {
        if self.levels.len() <= depth {
            self.levels.resize(depth + 1, AuditLevel::default());
        }
        &mut self.levels[depth]
    }
}

/// `rect`, from its west or north end, at most [`MAX_STRETCH`] times
/// longer than wide, or as long as `natural` if that is longer.
fn bounded(rect: Rect, natural: (u32, u32)) -> Rect {
    if rect.width >= rect.height {
        let width = rect.width.min((MAX_STRETCH * rect.height).max(natural.0));
        Rect { width, ..rect }
    } else {
        let height = rect.height.min((MAX_STRETCH * rect.width).max(natural.1));
        Rect {
            y: rect.y + rect.height - height,
            height,
            ..rect
        }
    }
}

impl Node {
    /// Places the tree with its south-west corner at the origin, in its
    /// preferred shape.
    pub(crate) fn place(&self) -> Placed {
        self.place_with(Placed::default())
    }

    /// Places the tree as [`Node::place`] does, and says where its area went.
    pub(crate) fn place_audited(&self) -> Placed {
        self.place_with(Placed {
            audit: Some(Audit::default()),
            ..Placed::default()
        })
    }

    fn place_with(&self, mut placed: Placed) -> Placed {
        let choice = self.preferred();
        let (width, height) = self.size(choice);
        self.place_in(
            choice,
            Rect {
                x: 0,
                y: 0,
                width,
                height,
            },
            &mut placed,
            0,
        );
        placed
    }

    /// Places the node, in shape `choice`, in `rect`, which is at least
    /// that big, `depth` frames below the root.
    fn place_in(&self, choice: u32, rect: Rect, placed: &mut Placed, depth: usize) {
        let rect = match &self.kind {
            Kind::Grid { .. } | Kind::Frame { stretch: true, .. } => {
                let bounded = bounded(rect, self.size(choice));
                if let Some(level) = placed.audit_at(depth) {
                    level.ground +=
                        area(rect.width, rect.height) - area(bounded.width, bounded.height);
                }
                bounded
            }
            _ => rect,
        };
        match &self.kind {
            Kind::Grid { lots } => {
                if let Some(level) = placed.audit_at(depth) {
                    let asked = u64::from(*lots) * area(LOT, LOT);
                    level.lots += asked;
                    level.extra_lots += area(rect.width, rect.height) - asked;
                }
                let (columns, rows) = (rect.width / LOT, rect.height / LOT);
                placed.grids.push((
                    self.id,
                    rect.x + (rect.width - columns * LOT) / 2,
                    rect.y + (rect.height - rows * LOT) / 2,
                    columns,
                    rows,
                ));
            }
            Kind::Frame {
                padding,
                stretch,
                child,
                ..
            } => {
                let rect = if *stretch {
                    rect
                } else {
                    let (width, height) = self.size(choice);
                    if let Some(level) = placed.audit_at(depth) {
                        level.water += area(rect.width, rect.height) - area(width, height);
                    }
                    Rect {
                        x: rect.x + (rect.width - width) / 2,
                        y: rect.y + (rect.height - height) / 2,
                        width,
                        height,
                    }
                };
                placed.frames.push((self.id, rect, *stretch));
                let inner = Rect {
                    x: rect.x + padding,
                    y: rect.y + padding,
                    width: rect.width - 2 * padding,
                    height: rect.height - 2 * padding,
                };
                if let Some(level) = placed.audit_at(depth) {
                    level.padding +=
                        area(rect.width, rect.height) - area(inner.width, inner.height);
                }
                child.place_in(choice, inner, placed, depth + 1);
            }
            Kind::Pack { items, shapes, .. } => {
                // The shape that fills `rect` best, of those that fit in it
                let mut best = (choice, 0u64);
                for (index, shape) in (0..).zip(shapes) {
                    let fits = shape.width <= rect.width && shape.height <= rect.height;
                    if fits && area_of(shape) > best.1 {
                        best = (index, area_of(shape));
                    }
                }
                let shape = &shapes[best.0 as usize];
                let item = |index: usize| (&items[index], shape.choices[index]);
                if let Some(level) = placed.audit_at(depth) {
                    let size_of = |index: usize| items[index].size(shape.choices[index]);
                    let (shorter, narrower) = shape.rows.slack(&size_of);
                    level.shorter += shorter;
                    level.narrower += narrower;
                    for (node, &choice) in items.iter().zip(&shape.choices) {
                        let (width, height) = node.size(choice);
                        let needed = match node.innermost() {
                            (
                                Self {
                                    kind: Kind::Grid { lots },
                                    ..
                                },
                                0,
                            ) => u64::from(*lots) * area(LOT, LOT),
                            _ => node.weight,
                        };
                        #[allow(clippy::cast_possible_wrap)]
                        let change = area(width, height) as i64 - needed as i64;
                        level.reshaped += change;
                    }
                }
                shape.rows.place_in(&item, rect, placed, depth);
            }
        }
    }
}

impl Shape {
    /// The room the shape leaves empty at its own size: under the items
    /// shorter than their row, and beside the rows narrower than the shape.
    fn slack(&self, size_of: &impl Fn(usize) -> (u32, u32)) -> (u64, u64) {
        let Self::Split {
            axis,
            children,
            width,
            height,
            ..
        } = self
        else {
            return (0, 0);
        };
        let (mut shorter, mut narrower) = (0, 0);
        for child in children {
            let (child_width, child_height) = child.size(size_of);
            match axis {
                Axis::X => shorter += area(child_width, height - child_height),
                Axis::Y => narrower += area(width - child_width, child_height),
            }
            let (inner_shorter, inner_narrower) = child.slack(size_of);
            shorter += inner_shorter;
            narrower += inner_narrower;
        }
        (shorter, narrower)
    }

    /// Places the shape in `rect`, which is at least its size: each child
    /// gets the whole of `rect` across, and its share of the room along.
    /// `item` gives each item and the shape it takes.
    fn place_in<'a>(
        &self,
        item: &impl Fn(usize) -> (&'a Node, u32),
        rect: Rect,
        placed: &mut Placed,
        depth: usize,
    ) {
        let size_of = |index: usize| {
            let (node, choice) = item(index);
            node.size(choice)
        };
        let (axis, gaps, children) = match self {
            Self::Item(index) => {
                let (node, choice) = item(*index);
                return node.place_in(choice, rect, placed, depth);
            }
            Self::Split {
                axis,
                gaps,
                children,
                ..
            } => (*axis, gaps, children),
        };
        let natural: u64 = children
            .iter()
            .map(|child| u64::from(child.extent(&size_of, axis)))
            .sum();
        let available = match axis {
            Axis::X => rect.width,
            Axis::Y => rect.height,
        };
        let extra = u64::from(available - self.extent(&size_of, axis));
        let mut given = 0;
        // West to east, or north to south
        let mut cursor = 0;
        for (index, child) in children.iter().enumerate() {
            let size = u64::from(child.extent(&size_of, axis));
            let share = if index + 1 == children.len() {
                extra - given
            } else {
                (extra * size).checked_div(natural).unwrap_or(0)
            };
            given += share;
            // At most `available`, so it fits in a u32
            let length = u32::try_from(size + share).unwrap_or(u32::MAX);
            let cell = match axis {
                Axis::X => Rect {
                    x: rect.x + cursor,
                    y: rect.y,
                    width: length,
                    height: rect.height,
                },
                Axis::Y => Rect {
                    x: rect.x,
                    y: rect.y + rect.height - cursor - length,
                    width: rect.width,
                    height: length,
                },
            };
            child.place_in(item, cell, placed, depth);
            let gap = gaps.get(index).copied().unwrap_or(0);
            if let Some(level) = placed.audit_at(depth) {
                level.gaps += area(
                    gap,
                    match axis {
                        Axis::X => rect.height,
                        Axis::Y => rect.width,
                    },
                );
            }
            cursor += length + gap;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::treemap::tests::{LOTS, parcels};
    use crate::layout::treemap::{Gap, MIN_CHANNEL};

    /// The space between two rectangles, negative when they overlap.
    fn spacing(a: Rect, b: Rect) -> i64 {
        let gap = |start: u32, length: u32, other: u32, other_length: u32| {
            (i64::from(other) - i64::from(start + length))
                .max(i64::from(start) - i64::from(other + other_length))
        };
        gap(a.x, a.width, b.x, b.width).max(gap(a.y, a.height, b.y, b.height))
    }

    fn grid_rect(grid: &(u32, u32, u32, u32, u32)) -> Rect {
        Rect {
            x: grid.1,
            y: grid.2,
            width: grid.3 * LOT,
            height: grid.4 * LOT,
        }
    }

    #[test]
    fn items_never_overlap_and_keep_their_gaps() {
        let tree = Node::pack(99, parcels(), 1.0, Gap::Fixed(9));
        let placed = tree.place();
        assert_eq!(placed.frames.len(), 10);
        assert_eq!(placed.grids.len(), 10);
        for (index, &(_, a, _)) in placed.frames.iter().enumerate() {
            assert!(a.x + a.width <= tree.width() && a.y + a.height <= tree.height());
            for &(_, b, _) in &placed.frames[index + 1..] {
                assert!(spacing(a, b) >= 9, "{a:?} and {b:?} are less than 9 apart");
            }
        }
        // Each grid holds its lots, inside its frame's padding
        for grid in &placed.grids {
            assert!(grid.3 * grid.4 >= LOTS[grid.0 as usize]);
            let frame = placed
                .frames
                .iter()
                .find(|frame| frame.0 == grid.0)
                .unwrap()
                .1;
            let rect = grid_rect(grid);
            assert!(rect.x >= frame.x + 3 && rect.y >= frame.y + 3);
            assert!(rect.x + rect.width <= frame.x + frame.width - 3);
            assert!(rect.y + rect.height <= frame.y + frame.height - 3);
        }
    }

    #[test]
    fn grids_are_mostly_full() {
        let items: Vec<Node> = (0..30).map(|id| Node::grid(id, 4 + id % 5)).collect();
        let tree = Node::pack(99, items, 1.0, Gap::Fixed(4));
        let ratio =
            f64::from(tree.width().max(tree.height())) / f64::from(tree.width().min(tree.height()));
        assert!(ratio < 2.0, "{} × {}", tree.width(), tree.height());
        let lots: u32 = (0..30).map(|id| 4 + id % 5).sum();
        let placed = tree.place();
        let given: u32 = placed.grids.iter().map(|grid| grid.3 * grid.4).sum();
        assert!(
            f64::from(lots) / f64::from(given) > 0.75,
            "{lots} of {given}"
        );
    }

    #[test]
    fn a_fixed_frame_stays_centred_in_a_larger_cell() {
        let big = Node::frame(0, 9, false, Node::grid(0, 100), (0, 0));
        let small = Node::frame(1, 9, false, Node::grid(1, 1), (100, 66));
        let tree = Node::pack(99, vec![small, big], 1.0, Gap::Channel);
        let placed = tree.place();
        let small = placed.frames.iter().find(|frame| frame.0 == 1).unwrap();
        assert!(small.1.width >= 66 && small.1.height >= 66);
        assert!(!placed.frames.iter().any(|frame| frame.2));
        let big = placed.frames.iter().find(|frame| frame.0 == 0).unwrap();
        assert!(spacing(small.1, big.1) >= i64::from(MIN_CHANNEL));
    }

    #[test]
    fn the_same_items_give_the_same_layout() {
        let items = || -> Vec<Node> { (0..12).map(|id| Node::grid(id, 1 + id * 3 % 7)).collect() };
        assert_eq!(
            Node::pack(99, items(), 1.3, Gap::Fixed(9)).place(),
            Node::pack(99, items(), 1.3, Gap::Fixed(9)).place()
        );
    }

    #[test]
    fn the_audit_accounts_for_the_whole_area() {
        let folder = |id: u32, sizes: &[u32]| {
            let grids = sizes
                .iter()
                .zip(0..)
                .map(|(&lots, index)| Node::grid(id * 10 + index, lots))
                .collect();
            Node::frame(
                id,
                3,
                true,
                Node::pack(id, grids, 1.0, Gap::Fixed(4)),
                (0, 0),
            )
        };
        let island = Node::pack(
            0,
            vec![
                folder(1, &[7, 2, 1]),
                folder(2, &[30]),
                folder(3, &[3, 3, 5, 1]),
            ],
            1.3,
            Gap::Fixed(18),
        );
        let islands = vec![
            Node::frame(0, 9, false, island, (100, 66)),
            Node::frame(1, 9, false, Node::grid(9, 2), (100, 66)),
        ];
        let city = Node::pack(u32::MAX, islands, 1.6, Gap::Channel);
        let placed = city.place_audited();
        let audit = placed.audit.clone().unwrap();
        // The placement itself does not depend on the audit
        assert_eq!(
            Placed {
                audit: None,
                ..placed
            },
            city.place()
        );
        let accounted: u64 = audit
            .levels
            .iter()
            .map(|level| {
                level.lots
                    + level.extra_lots
                    + level.gaps
                    + level.padding
                    + level.water
                    + level.ground
            })
            .sum();
        assert_eq!(accounted, area(city.width(), city.height()));
        assert_eq!(
            audit.levels.iter().map(|level| level.lots).sum::<u64>(),
            54 * 400
        );
    }

    #[test]
    fn a_stretched_parcel_stays_within_four_times_its_width() {
        let natural = (2 * LOT, LOT);
        let wide = Rect {
            x: 10,
            y: 20,
            width: 30 * LOT,
            height: LOT,
        };
        assert_eq!(
            bounded(wide, natural),
            Rect {
                width: 4 * LOT,
                ..wide
            }
        );
        // Kept at the north end of a tall place
        let tall = Rect {
            x: 10,
            y: 20,
            width: LOT,
            height: 30 * LOT,
        };
        assert_eq!(
            bounded(tall, natural),
            Rect {
                y: 20 + 26 * LOT,
                height: 4 * LOT,
                ..tall
            }
        );
        // A shape longer on its own keeps its length
        assert_eq!(
            bounded(wide, (6 * LOT, LOT)),
            Rect {
                width: 6 * LOT,
                ..wide
            }
        );

        let folder = |id: u32, lots: u32| Node::frame(id, 3, true, Node::grid(id, lots), (0, 0));
        let mut items = vec![folder(0, 120), folder(1, 90)];
        items.extend((2..12).map(|id| folder(id, 1)));
        let placed = Node::pack(99, items, 1.0, Gap::Fixed(9)).place();
        for &(id, rect, _) in &placed.frames {
            let (long, short) = (rect.width.max(rect.height), rect.width.min(rect.height));
            assert!(long <= MAX_STRETCH * short, "parcel {id}: {rect:?}");
        }
    }

    #[test]
    fn one_item_or_none() {
        let empty = Node::pack(7, Vec::new(), 1.0, Gap::Fixed(9)).place();
        assert!(empty.grids.is_empty() && empty.frames.is_empty());
        assert_eq!(empty.audit, None);
        let audited = Node::pack(7, Vec::new(), 1.0, Gap::Fixed(9)).place_audited();
        assert!(
            audited
                .audit
                .unwrap()
                .levels
                .iter()
                .all(|level| *level == AuditLevel::default())
        );
        let grid = Node::grid(3, 5);
        assert_eq!(Node::pack(7, vec![grid.clone()], 1.0, Gap::Fixed(9)), grid);
    }
}
