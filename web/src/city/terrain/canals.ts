import type { IslandLayout, Rect } from '../world/layout'
import type { Side } from './island-shape'

// Canals run in the gaps the layout leaves between an island's folders (1.8 u). A canal is the
// gap between two folders that face each other, along the whole stretch where they do. Where
// canals meet, a hole is left between the end of one and the next folder or canal: a crossing,
// filled in turn. Strips left along a grid, and room left at the end of a row, stay paved.

/** Paving between the plateau's edge and its folders. */
export const ISLAND_MARGIN = 0.9
/** The quay along each bank: the water is the gap less a quay on each side. */
export const QUAY_WIDTH = 0.3
/** Gaps of this width, in u, are canals: the layout leaves 1.8 u between two folders. */
const CANAL_GAP = [1.5, 2.1] as const
/**
 * The square of an island's own files is centred in its cell: it may stand up to a lot's
 * half more away from a folder than a canal is wide, and still face it across one.
 */
const SQUARE_REACH = 2.9
const FOLDER_GAP = 1.8
/** A canal at least this long gets a footbridge halfway along. */
const FOOTBRIDGE_RUN = 6
/** How close two edges must be to count as touching. */
const TOUCH = 0.01

export interface CanalCell {
  rect: Rect
  /** The banks with a quay; a side open to more water has none. */
  quays: Record<Side, boolean>
  /** The side where the canal reaches the plateau's margin and pours over the edge. */
  mouth?: Side
}

export interface Footbridge {
  /** The deck, from bank to bank. */
  rect: Rect
}

/**
 * A folder's corner on a crossing, where the quays of two canals meet: the quay turns around it
 * in a quarter circle. `sx` and `sy` point from the corner into the water.
 */
export interface Bend {
  x: number
  y: number
  sx: 1 | -1
  sy: 1 | -1
}

export interface Canals {
  cells: CanalCell[]
  footbridges: Footbridge[]
  bends: Bend[]
}

const NONE: Canals = { cells: [], footbridges: [], bends: [] }

/** Rounds to a hundredth of a unit, so that edges from different folders line up. */
const snap = (value: number) => Math.round(value * 100) / 100

const isCanalGap = (width: number) => width >= CANAL_GAP[0] - TOUCH && width <= CANAL_GAP[1] + TOUCH

/** Whether two rectangles share some area (touching edges do not count). */
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width - TOUCH &&
  b.x < a.x + a.width - TOUCH &&
  a.y < b.y + b.height - TOUCH &&
  b.y < a.y + a.height - TOUCH

const sameRect = (a: Rect, b: Rect) =>
  Math.abs(a.x - b.x) < TOUCH &&
  Math.abs(a.y - b.y) < TOUCH &&
  Math.abs(a.width - b.width) < TOUCH &&
  Math.abs(a.height - b.height) < TOUCH

/** A stretch of water: which way it runs, or both for a crossing. */
interface Water {
  rect: Rect
  alongY: boolean
  alongX: boolean
}

export function islandCanals(island: IslandLayout): Canals {
  const obstacles = island.parcels
    .filter((parcel) => parcel.level === 1)
    .map((parcel) => parcel.rect)
  if (island.square) {
    obstacles.push(squareToCanals(island.square, obstacles))
  }
  if (obstacles.length < 2) {
    return NONE
  }
  const { plateau } = island
  const inner = {
    x: plateau.x + ISLAND_MARGIN,
    y: plateau.y + ISLAND_MARGIN,
    width: plateau.width - 2 * ISLAND_MARGIN,
    height: plateau.height - 2 * ISLAND_MARGIN,
  }

  // Canals: the gap between two folders face to face, along their overlap.
  const water: Water[] = []
  for (const a of obstacles) {
    for (const b of obstacles) {
      // b east of a: water running along y
      const across = snap(b.x - (a.x + a.width))
      const y0 = Math.max(a.y, b.y)
      const y1 = Math.min(a.y + a.height, b.y + b.height)
      if (isCanalGap(across) && y1 - y0 > TOUCH) {
        water.push({
          rect: { x: a.x + a.width, y: y0, width: across, height: snap(y1 - y0) },
          alongY: true,
          alongX: false,
        })
      }
      // b north of a: water running along x
      const up = snap(b.y - (a.y + a.height))
      const x0 = Math.max(a.x, b.x)
      const x1 = Math.min(a.x + a.width, b.x + b.width)
      if (isCanalGap(up) && x1 - x0 > TOUCH) {
        water.push({
          rect: { x: x0, y: a.y + a.height, width: snap(x1 - x0), height: up },
          alongY: false,
          alongX: true,
        })
      }
    }
  }

  // Crossings: past each end of a canal, the hole up to the next folder or water, when it is no
  // longer than a canal is wide. One pass is enough: a crossing is reached from every canal
  // that ends on it.
  const crossings: Water[] = []
  for (const canal of water) {
    for (const end of [-1, 1] as const) {
      const hole = holePast(canal, end, obstacles, water, inner)
      // Two canals ending on one crossing find the same hole; canals out of line find holes
      // that overlap, both kept: water over water does not show.
      if (hole && !crossings.some((crossing) => sameRect(crossing.rect, hole))) {
        crossings.push({ rect: hole, alongX: true, alongY: true })
      }
    }
  }
  const all = [...water, ...crossings]

  // A side is open where the strip just past it reaches other water.
  const open = (rect: Rect, side: Side) => {
    const strip = outside(rect, side)
    return all.some((other) => other.rect !== rect && overlaps(other.rect, strip))
  }
  const cells: CanalCell[] = all.map(({ rect, alongX, alongY }) => {
    let mouth: Side | undefined
    if (alongY && !alongX && Math.abs(rect.y - inner.y) < TOUCH) {
      mouth = 'south'
    } else if (
      alongY &&
      !alongX &&
      Math.abs(rect.y + rect.height - (inner.y + inner.height)) < TOUCH
    ) {
      mouth = 'north'
    } else if (alongX && !alongY && Math.abs(rect.x - inner.x) < TOUCH) {
      mouth = 'west'
    } else if (
      alongX &&
      !alongY &&
      Math.abs(rect.x + rect.width - (inner.x + inner.width)) < TOUCH
    ) {
      mouth = 'east'
    }
    const sides: Side[] = ['west', 'east', 'south', 'north']
    const quays = Object.fromEntries(
      sides.map((side) => [side, side !== mouth && !open(rect, side)]),
    ) as Record<Side, boolean>
    return { rect, quays, ...(mouth ? { mouth } : {}) }
  })

  // One footbridge halfway along each long enough canal.
  const footbridges: Footbridge[] = water.flatMap(({ rect, alongY }): Footbridge[] => {
    const length = alongY ? rect.height : rect.width
    if (length < FOOTBRIDGE_RUN) {
      return []
    }
    return [
      {
        rect: alongY
          ? { x: rect.x, y: rect.y + length / 2 - 0.3, width: rect.width, height: 0.6 }
          : { x: rect.x + length / 2 - 0.3, y: rect.y, width: 0.6, height: rect.height },
      },
    ]
  })
  // Where a crossing's corner is a folder's corner, the quays of its two canals meet.
  const bends: Bend[] = []
  for (const { rect } of crossings) {
    for (const [sx, sy] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ] as const) {
      const x = snap(sx > 0 ? rect.x : rect.x + rect.width)
      const y = snap(sy > 0 ? rect.y : rect.y + rect.height)
      const cornered = obstacles.some(
        (folder) =>
          Math.abs((sx > 0 ? folder.x + folder.width : folder.x) - x) < TOUCH &&
          Math.abs((sy > 0 ? folder.y + folder.height : folder.y) - y) < TOUCH,
      )
      const known = bends.some(
        (bend) => Math.abs(bend.x - x) < TOUCH && Math.abs(bend.y - y) < TOUCH,
      )
      if (cornered && !known) {
        bends.push({ x, y, sx, sy })
      }
    }
  }
  return { cells, footbridges, bends }
}

/**
 * The square, grown toward each folder it faces from farther than a canal is wide, up to the
 * usual gap between two folders: its canals then run along it as along any folder. What it
 * grows by stays paving.
 */
function squareToCanals(square: Rect, folders: readonly Rect[]): Rect {
  // The nearest folder facing each side, if any.
  let [west, east, south, north] = [Infinity, Infinity, Infinity, Infinity]
  for (const folder of folders) {
    const alongY =
      Math.min(square.y + square.height, folder.y + folder.height) - Math.max(square.y, folder.y)
    const alongX =
      Math.min(square.x + square.width, folder.x + folder.width) - Math.max(square.x, folder.x)
    if (alongY > TOUCH) {
      const ahead = snap(folder.x - (square.x + square.width))
      const behind = snap(square.x - (folder.x + folder.width))
      if (ahead > -TOUCH) east = Math.min(east, ahead)
      if (behind > -TOUCH) west = Math.min(west, behind)
    }
    if (alongX > TOUCH) {
      const ahead = snap(folder.y - (square.y + square.height))
      const behind = snap(square.y - (folder.y + folder.height))
      if (ahead > -TOUCH) north = Math.min(north, ahead)
      if (behind > -TOUCH) south = Math.min(south, behind)
    }
  }
  const grow = (gap: number) =>
    gap > CANAL_GAP[1] + TOUCH && gap <= SQUARE_REACH + TOUCH ? snap(gap - FOLDER_GAP) : 0
  const [w, e, s, n] = [grow(west), grow(east), grow(south), grow(north)]
  return {
    x: snap(square.x - w),
    y: snap(square.y - s),
    width: snap(square.width + w + e),
    height: snap(square.height + s + n),
  }
}

/** A thin strip just past one side of a rectangle. */
function outside(rect: Rect, side: Side): Rect {
  const t = 2 * TOUCH
  switch (side) {
    case 'west':
      return { x: rect.x - t, y: rect.y, width: t, height: rect.height }
    case 'east':
      return { x: rect.x + rect.width, y: rect.y, width: t, height: rect.height }
    case 'south':
      return { x: rect.x, y: rect.y - t, width: rect.width, height: t }
    case 'north':
      return { x: rect.x, y: rect.y + rect.height, width: rect.width, height: t }
  }
}

/**
 * The hole past one end of a canal (`end` -1 for its start, 1 for its end), as wide as the
 * canal, up to the nearest folder or other water ahead: a crossing when it is short enough and
 * stops on something. Nothing when the canal ends on a folder, on water, or at the margin.
 */
function holePast(
  canal: Water,
  end: -1 | 1,
  obstacles: readonly Rect[],
  water: readonly Water[],
  inner: Rect,
): Rect | undefined {
  const { rect, alongY } = canal
  const start = alongY
    ? end > 0
      ? rect.y + rect.height
      : rect.y
    : end > 0
      ? rect.x + rect.width
      : rect.x
  const lateral0 = alongY ? rect.x : rect.y
  const lateral1 = alongY ? rect.x + rect.width : rect.y + rect.height
  const limit = alongY
    ? end > 0
      ? inner.y + inner.height
      : inner.y
    : end > 0
      ? inner.x + inner.width
      : inner.x
  // How far ahead the nearest thing in the canal's lane stands.
  let reach = Math.abs(limit - start)
  let blocked = false
  const blockers = [
    ...obstacles,
    ...water.filter((other) => other !== canal).map((other) => other.rect),
  ]
  for (const other of blockers) {
    const o0 = alongY ? other.x : other.y
    const o1 = alongY ? other.x + other.width : other.y + other.height
    if (o1 <= lateral0 + TOUCH || o0 >= lateral1 - TOUCH) {
      continue
    }
    const near = alongY
      ? end > 0
        ? other.y
        : other.y + other.height
      : end > 0
        ? other.x
        : other.x + other.width
    const distance = (near - start) * end
    if (distance < -TOUCH) {
      continue
    }
    // Something that overlaps the lane at the canal's very end: nothing to fill.
    const far = alongY
      ? end > 0
        ? other.y + other.height
        : other.y
      : end > 0
        ? other.x + other.width
        : other.x
    if (distance <= TOUCH && (far - start) * end > TOUCH) {
      return undefined
    }
    if (distance < reach) {
      reach = distance
      blocked = true
    }
  }
  if (!blocked || reach <= TOUCH || reach > CANAL_GAP[1] + TOUCH) {
    return undefined
  }
  const from = end > 0 ? start : start - reach
  return alongY
    ? { x: rect.x, y: from, width: rect.width, height: snap(reach) }
    : { x: from, y: rect.y, width: snap(reach), height: rect.height }
}
