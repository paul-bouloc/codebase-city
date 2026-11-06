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

/// A lot is 2 × 2 u.
pub(crate) const LOT: u32 = 20;

/// How much wider than tall the shapes of a pack are: from a twelfth to
/// twelve, each about 17 % wider than the last. Finer steps let an item
/// come closer to the height of its row.
const ASPECTS: [f64; 33] = [
    0.083333, 0.097335, 0.11369, 0.13279, 0.1551, 0.18116, 0.2116, 0.24715, 0.28868, 0.33718,
    0.39383, 0.46, 0.53728, 0.62756, 0.733, 0.85615, 1.0, 1.168, 1.3643, 1.5935, 1.8612, 2.1739,
    2.5392, 2.9658, 3.4641, 4.0461, 4.7259, 5.52, 6.4474, 7.5307, 8.796, 10.274, 12.0,
];

/// How many times a row's height is corrected to make it as wide as its
/// pack.
const ROW_FITS: usize = 4;

/// How much longer than wide a parcel or a grid may be stretched, unless
/// its own shape is longer: past that, the rest of its place is left as
/// free ground. A small folder alone in a wide row would otherwise become
/// a strip of empty lots.
const MAX_STRETCH: u32 = 4;

/// The worst aspect ratio a last row keeps before it joins the row above.
const LAST_ROW_RATIO: f64 = 3.0;

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
        node.weight = u64::from(width) * u64::from(height);
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
            let shapes: Vec<PackShape> = ASPECTS
                .iter()
                .map(|&aspect| rows(&items, (area * aspect).sqrt(), gap, stack))
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
            // Islands keep their own size, and what a stack leaves around them
            // is water: for the archipelago's few islands, the smaller city of
            // the two ways
            let (flat, flat_preferred) = shapes_of(false);
            if area_of(&flat[flat_preferred as usize]) < area_of(&shapes[preferred as usize]) {
                (shapes, preferred) = (flat, flat_preferred);
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
                    let area = u64::from(shape.width) * u64::from(shape.height);
                    if shape.width <= rect.width && shape.height <= rect.height && area > best.1 {
                        best = (index, area);
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

/// Lays `items`, heaviest first, out in rows about `width` wide, from the
/// north, small items stacked or not: see [`lay_rows`].
fn rows(items: &[Node], width: f64, gap: Gap, stack: bool) -> PackShape {
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

    const LOTS: [u32; 10] = [40, 1, 7, 7, 23, 3, 12, 2, 2, 60];

    fn parcels() -> Vec<Node> {
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
