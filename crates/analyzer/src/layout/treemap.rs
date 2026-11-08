//! A treemap in rows whose leaves are grids of lots.
//!
//! A pack lays its items out in rows as wide as itself, the heaviest first
//! (a strip treemap, after Bederson), and closes a row when one more item
//! would make it less square (the criterion of the squarified treemap, after
//! Bruls, Huizing and van Wijk). Each item then takes the height of its
//! row: a grid by changing its columns and rows, a pack by picking the one
//! of its shapes that comes closest. A pack works its shapes out once, for
//! a range of widths, from its items' own shapes: nothing is laid out twice.
//! What an item still cannot fill is stretched over when the rectangles are
//! placed, and a stretched grid gains empty lots.
//!
//! Lengths are in tenths of a unit, x to the east and y to the north.

pub(super) mod place;
mod rows;

/// A lot is 2 × 2 u.
pub(crate) const LOT: u32 = 20;

/// How many shapes a pack works out, from a twelfth to twelve times wider
/// than tall, each about 17 % wider than the last. Finer steps let an item
/// come closer to the height of its row.
const SHAPES: usize = 33;

/// How much wider than tall each of a pack's shapes is.
fn aspects() -> impl Iterator<Item = f64> {
    let middle = (SHAPES / 2) as f64;
    (0..SHAPES).map(move |index| 12f64.powf((index as f64 - middle) / middle))
}

/// The proportions, width over height, the archipelago may take.
const ARCHIPELAGO_RATIOS: (f64, f64) = (1.2, 2.2);

/// How much longer than wide a parcel or a grid may be stretched, unless
/// its own shape is longer: past that, the rest of its place is left as
/// free ground. A small folder alone in a wide row would otherwise become
/// a strip of empty lots.
const MAX_STRETCH: u32 = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Axis {
    X,
    Y,
}

impl Axis {
    fn other(self) -> Self {
        match self {
            Self::X => Self::Y,
            Self::Y => Self::X,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Rect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// The space between two neighbours of a pack.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Gap {
    Fixed(u32),
    /// Water between islands: 22 % of the facing sides, 14 to 24 u.
    Channel,
}

/// The narrowest channel between two islands, in tenths of a unit: their beaches and foam take
/// up to 8.4 u of it, and some open water must show between them.
const MIN_CHANNEL: u32 = 140;
/// The widest channel, in tenths of a unit.
const MAX_CHANNEL: u32 = 240;

impl Gap {
    fn between(self, facing: u32) -> u32 {
        match self {
            Self::Fixed(gap) => gap,
            Self::Channel => (facing * 22 / 100).clamp(MIN_CHANNEL, MAX_CHANNEL),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Kind {
    /// Lots for `lots` files or more. Its shapes are its numbers of rows.
    Grid { lots: u32 },
    /// A rectangle around one node, `padding` inside it, at least `min`. A
    /// frame that does not stretch keeps its own size, centred in what it
    /// is given. Its shapes are its child's.
    Frame {
        padding: u32,
        stretch: bool,
        min: (u32, u32),
        child: Box<Node>,
    },
    /// Items laid out in rows, in one of several shapes.
    Pack {
        items: Vec<Node>,
        shapes: Vec<PackShape>,
        /// The shape the pack takes when nothing asks for another.
        preferred: u32,
    },
}

/// One way to lay a pack's items out.
#[derive(Debug, Clone, PartialEq, Eq)]
struct PackShape {
    rows: Shape,
    /// The shape each item takes.
    choices: Vec<u32>,
    width: u32,
    height: u32,
}

/// How a pack's items are arranged.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Shape {
    Item(usize),
    /// Shapes side by side along `axis`, the first to the west or north,
    /// `gaps[i]` between shape `i` and the next.
    Split {
        axis: Axis,
        gaps: Vec<u32>,
        children: Vec<Shape>,
        width: u32,
        height: u32,
    },
}

/// A node of the treemap.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Node {
    /// The caller's name for the node: placed grids and frames carry it.
    id: u32,
    kind: Kind,
    /// The area of the node's preferred shape, which orders a pack's items.
    weight: u64,
}

fn area(width: u32, height: u32) -> u64 {
    u64::from(width) * u64::from(height)
}

impl Node {
    fn new(id: u32, kind: Kind) -> Self {
        let mut node = Self {
            id,
            kind,
            weight: 0,
        };
        let (width, height) = node.size(node.preferred());
        node.weight = area(width, height);
        node
    }

    /// A grid for `lots` lots.
    pub(crate) fn grid(id: u32, lots: u32) -> Self {
        Self::new(id, Kind::Grid { lots: lots.max(1) })
    }

    /// A frame around `child`, at least `min` wide and tall.
    pub(crate) fn frame(
        id: u32,
        padding: u32,
        stretch: bool,
        child: Self,
        min: (u32, u32),
    ) -> Self {
        Self::new(
            id,
            Kind::Frame {
                padding,
                stretch,
                min,
                child: Box::new(child),
            },
        )
    }

    /// `items` in rows, preferably about `aspect` times wider than tall;
    /// the item itself when there is only one.
    pub(crate) fn pack(id: u32, mut items: Vec<Self>, aspect: f64, gap: Gap) -> Self {
        if items.len() == 1 {
            return items.pop().unwrap_or_else(|| Self::empty(id));
        }
        if items.is_empty() {
            return Self::empty(id);
        }
        // Heaviest first, the given order between equals
        items.sort_by_key(|item| std::cmp::Reverse(item.weight));
        let area: f64 = items
            .iter()
            .map(|item| {
                let side = (item.weight as f64).sqrt();
                let gap = f64::from(gap.between(item_side(item)));
                (side + gap) * (side + gap)
            })
            .sum();
        let shapes_of = |stack: bool| -> (Vec<PackShape>, u32) {
            let shapes: Vec<PackShape> = aspects()
                .map(|aspect| rows::rows(&items, (area * aspect).sqrt(), gap, stack))
                .collect();
            let preferred = closest(&shapes, |shape| {
                (f64::from(shape.width) / f64::from(shape.height.max(1)) / aspect)
                    .ln()
                    .abs()
            });
            (shapes, preferred)
        };
        let (mut shapes, mut preferred) = shapes_of(true);
        if gap == Gap::Channel {
            // Islands keep their own size, and what a pack leaves around them
            // is water. The archipelago has few islands: of both ways, stacked
            // or not, the smallest city in a fair range of proportions, not
            // the one closest to `aspect`, which may be much larger
            let (flat, _) = shapes_of(false);
            let fair = |shape: &PackShape| {
                let ratio = f64::from(shape.width) / f64::from(shape.height.max(1));
                (ARCHIPELAGO_RATIOS.0..=ARCHIPELAGO_RATIOS.1).contains(&ratio)
            };
            let stacked_best = (0..)
                .zip(&shapes)
                .filter(|(_, shape)| fair(shape))
                .min_by_key(|(_, shape)| area_of(shape))
                .map(|(index, shape)| (index, area_of(shape)));
            let flat_best = (0..)
                .zip(&flat)
                .filter(|(_, shape)| fair(shape))
                .min_by_key(|(_, shape)| area_of(shape))
                .map(|(index, shape)| (index, area_of(shape)));
            match (stacked_best, flat_best) {
                (Some((_, stacked_area)), Some((index, flat_area))) if flat_area < stacked_area => {
                    (shapes, preferred) = (flat, index);
                }
                (Some((index, _)), _) => preferred = index,
                (None, Some((index, _))) => (shapes, preferred) = (flat, index),
                (None, None) => {}
            }
        }
        Self::new(
            id,
            Kind::Pack {
                items,
                shapes,
                preferred,
            },
        )
    }

    /// Nothing: an empty island.
    pub(crate) fn empty(id: u32) -> Self {
        let rows = Shape::Split {
            axis: Axis::X,
            gaps: Vec::new(),
            children: Vec::new(),
            width: 0,
            height: 0,
        };
        let shape = PackShape {
            rows,
            choices: Vec::new(),
            width: 0,
            height: 0,
        };
        Self::new(
            id,
            Kind::Pack {
                items: Vec::new(),
                shapes: vec![shape],
                preferred: 0,
            },
        )
    }

    /// The shape the node takes when nothing asks for another.
    fn preferred(&self) -> u32 {
        match &self.kind {
            Kind::Grid { lots } => {
                let columns = lots.isqrt() + u32::from(lots.isqrt().pow(2) < *lots);
                lots.div_ceil(columns)
            }
            Kind::Frame { child, .. } => child.preferred(),
            Kind::Pack { preferred, .. } => *preferred,
        }
    }

    /// The size of one of the node's shapes.
    fn size(&self, choice: u32) -> (u32, u32) {
        match &self.kind {
            Kind::Grid { lots } => {
                let rows = choice.max(1);
                (lots.div_ceil(rows) * LOT, rows * LOT)
            }
            Kind::Frame {
                padding,
                min,
                child,
                ..
            } => {
                let (width, height) = child.size(choice);
                (
                    (width + 2 * padding).max(min.0),
                    (height + 2 * padding).max(min.1),
                )
            }
            Kind::Pack { shapes, .. } => {
                let shape = &shapes[choice as usize];
                (shape.width, shape.height)
            }
        }
    }

    pub(crate) fn width(&self) -> u32 {
        self.size(self.preferred()).0
    }

    pub(crate) fn height(&self) -> u32 {
        self.size(self.preferred()).1
    }

    /// What the frames around a grid or a pack hold, and their padding in all.
    fn innermost(&self) -> (&Self, u32) {
        let mut node = self;
        let mut padding = 0u32;
        while let Kind::Frame {
            padding: own,
            child,
            ..
        } = &node.kind
        {
            padding = padding.saturating_add(*own);
            node = child;
        }
        (node, padding)
    }
}

fn area_of(shape: &PackShape) -> u64 {
    area(shape.width, shape.height)
}

/// The side of an item's preferred shape that faces its neighbours.
fn item_side(item: &Node) -> u32 {
    item.width().min(item.height())
}

/// The index of the shape with the smallest `cost`, the first among equals.
fn closest(shapes: &[PackShape], cost: impl Fn(&PackShape) -> f64) -> u32 {
    let mut best = (0, f64::INFINITY);
    for (index, shape) in (0..).zip(shapes) {
        let cost = cost(shape);
        if cost < best.1 {
            best = (index, cost);
        }
    }
    best.0
}

impl Shape {
    fn size(&self, size_of: &impl Fn(usize) -> (u32, u32)) -> (u32, u32) {
        match self {
            Self::Item(index) => size_of(*index),
            Self::Split { width, height, .. } => (*width, *height),
        }
    }

    fn extent(&self, size_of: &impl Fn(usize) -> (u32, u32), axis: Axis) -> u32 {
        let (width, height) = self.size(size_of);
        match axis {
            Axis::X => width,
            Axis::Y => height,
        }
    }

    fn split(
        size_of: &impl Fn(usize) -> (u32, u32),
        axis: Axis,
        gaps: Vec<u32>,
        children: Vec<Self>,
    ) -> Self {
        let along = children
            .iter()
            .map(|child| child.extent(size_of, axis))
            .sum::<u32>()
            + gaps.iter().sum::<u32>();
        let across = children
            .iter()
            .map(|child| child.extent(size_of, axis.other()))
            .max()
            .unwrap_or(0);
        let (width, height) = match axis {
            Axis::X => (along, across),
            Axis::Y => (across, along),
        };
        Self::Split {
            axis,
            gaps,
            children,
            width,
            height,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(super) const LOTS: [u32; 10] = [40, 1, 7, 7, 23, 3, 12, 2, 2, 60];

    pub(super) fn parcels() -> Vec<Node> {
        (0..)
            .zip(LOTS)
            .map(|(id, lots)| Node::frame(id, 3, true, Node::grid(id, lots), (0, 0)))
            .collect()
    }

    #[test]
    fn a_grid_is_as_square_as_it_gets() {
        let grid = Node::grid(0, 10);
        assert_eq!((grid.width(), grid.height()), (4 * LOT, 3 * LOT));
        let grid = Node::grid(0, 9);
        assert_eq!((grid.width(), grid.height()), (3 * LOT, 3 * LOT));
        let grid = Node::grid(0, 1);
        assert_eq!((grid.width(), grid.height()), (LOT, LOT));
    }

    #[test]
    fn the_archipelago_takes_its_smallest_fair_shape() {
        let island =
            |id: u32, lots: u32| Node::frame(id, 9, false, Node::grid(id, lots), (100, 66));
        let islands = [2000, 30, 20, 10, 5, 3, 2, 1, 1, 1, 1, 1]
            .into_iter()
            .zip(0..)
            .map(|(lots, id)| island(id, lots))
            .collect();
        let city = Node::pack(u32::MAX, islands, 1.6, Gap::Channel);
        let Kind::Pack {
            shapes, preferred, ..
        } = &city.kind
        else {
            panic!("not a pack");
        };
        let ratio = |shape: &PackShape| f64::from(shape.width) / f64::from(shape.height);
        let chosen = &shapes[*preferred as usize];
        assert!((ARCHIPELAGO_RATIOS.0..=ARCHIPELAGO_RATIOS.1).contains(&ratio(chosen)));
        for shape in shapes {
            if (ARCHIPELAGO_RATIOS.0..=ARCHIPELAGO_RATIOS.1).contains(&ratio(shape)) {
                assert!(area_of(chosen) <= area_of(shape));
            }
        }
    }
}
