import type { Point } from '../world/layout'
import { MinHeap } from './min-heap'
import {
  CELL,
  centreOf,
  clear,
  nearestWater,
  onLand,
  SHORE_REACH,
  shoreAt,
  type WaterGrid,
} from './water-grid'

// A ferry's way is searched on the water grid, where water costs more again where another ferry
// already sails, so that lines run side by side rather than over one another. The way found is
// then cut down to the few turns it needs, and a smooth curve drawn through them: wide bends, not
// corners.

/** Around a ferry's line, within this distance, water costs this much more to the next ones. */
const LANE_REACH = 2.5
const LANE_COST = 3
/** A ferry leaves its pier straight out for this far before it turns. */
const DEPARTURE = 5
/** Points along the smooth curve, about this far apart. */
const CURVE_STEP = 1
const CHAIKIN_ROUNDS = 4

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const

/**
 * A ferry's way from the tip of one pier to the tip of another, leaving each straight out along
 * its normal: a smooth curve on the water, null if none. Once found, it weighs on the ferries
 * routed after it, unless `weigh` is false (a line shown for a while only).
 */
export function ferryRoute(
  grid: WaterGrid,
  from: Point,
  fromNormal: Point,
  to: Point,
  toNormal: Point,
  weigh = true,
): Point[] | null {
  const out = departure(grid, from, fromNormal)
  const back = departure(grid, to, toNormal)
  const start = nearestWater(grid, out)
  const goal = nearestWater(grid, back)
  if (start < 0 || goal < 0) {
    return null
  }
  const cells = search(grid, start, goal)
  if (!cells) {
    return null
  }
  const turns = pulled(grid, [out, ...cells.map((cell) => centreOf(grid, cell)), back])
  const curve = spline([from, ...turns, to])
  const line = curve.every((point) => !onLand(grid, point))
    ? curve
    : smoothed(grid, [from, ...turns, to])
  if (weigh) {
    addTraffic(grid, line)
  }
  return line
}

/** A little out from a pier's tip, straight along its normal, if the water is there. */
function departure(grid: WaterGrid, tip: Point, normal: Point): Point {
  const out = { x: tip.x + normal.x * DEPARTURE, y: tip.y + normal.y * DEPARTURE }
  return clear(grid, tip, out) ? out : tip
}

/** A* between two cells, eight ways, never cutting a corner of land. */
function search(grid: WaterGrid, start: number, goal: number): number[] | null {
  const { columns, rows, land, cost, traffic } = grid
  const size = columns * rows
  const spent = new Float64Array(size).fill(Number.POSITIVE_INFINITY)
  const cameFrom = new Int32Array(size).fill(-1)
  const done = new Uint8Array(size)
  const heap = new MinHeap()
  const goalColumn = goal % columns
  const goalRow = Math.floor(goal / columns)
  // The open sea's cost: the heuristic never overestimates.
  const estimate = (cell: number) => {
    const dx = Math.abs((cell % columns) - goalColumn)
    const dy = Math.abs(Math.floor(cell / columns) - goalRow)
    return CELL * (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy))
  }
  const weight = (cell: number) => (cost[cell] ?? 1) + (traffic[cell] ?? 0)
  spent[start] = 0
  heap.push(start, estimate(start))
  while (heap.size > 0) {
    const cell = heap.pop()
    if (cell === goal) {
      const path: number[] = []
      for (let at = goal; at >= 0; at = cameFrom[at] ?? -1) {
        path.push(at)
      }
      return path.reverse()
    }
    if (done[cell] === 1) {
      continue
    }
    done[cell] = 1
    const column = cell % columns
    const row = Math.floor(cell / columns)
    for (const [dx, dy] of NEIGHBOURS) {
      const c = column + dx
      const r = row + dy
      if (c < 0 || r < 0 || c >= columns || r >= rows) {
        continue
      }
      const next = r * columns + c
      if (land[next] === 1 || done[next] === 1) {
        continue
      }
      const diagonal = dx !== 0 && dy !== 0
      if (diagonal && (land[row * columns + c] === 1 || land[r * columns + column] === 1)) {
        continue
      }
      const step = (diagonal ? Math.SQRT2 : 1) * CELL * ((weight(cell) + weight(next)) / 2)
      const total = (spent[cell] ?? 0) + step
      if (total < (spent[next] ?? Number.POSITIVE_INFINITY)) {
        spent[next] = total
        cameFrom[next] = cell
        heap.push(next, total + estimate(next))
      }
    }
  }
  return null
}

/**
 * Keeps only the turns: each point goes as far ahead as a straight line on water reaches, never
 * closer to a shore than the path it replaces.
 */
function pulled(grid: WaterGrid, points: readonly Point[]): Point[] {
  const first = points[0]
  if (!first) {
    return []
  }
  const kept = [first]
  let at = 0
  while (at < points.length - 1) {
    let next = at + 1
    let low = Math.min(shoreAt(grid, points[at] as Point), shoreAt(grid, points[next] as Point))
    while (next + 1 < points.length) {
      const ahead = points[next + 1] as Point
      const lowAhead = Math.min(low, shoreAt(grid, ahead))
      if (!clear(grid, points[at] as Point, ahead, Math.min(lowAhead, SHORE_REACH) - CELL)) {
        break
      }
      low = lowAhead
      next++
    }
    kept.push(points[next] as Point)
    at = next
  }
  return kept
}

/**
 * A centripetal Catmull-Rom curve through the points, from the first to the last: it bends wide
 * between turns far apart, and never loops on turns close together.
 */
export function spline(points: readonly Point[]): Point[] {
  if (points.length < 3) {
    return [...points]
  }
  const first = points[0] as Point
  const last = points.at(-1) as Point
  // Mirrored ends, so that the curve starts and ends on the first and last points.
  const second = points[1] as Point
  const beforeLast = points.at(-2) as Point
  const all = [
    { x: 2 * first.x - second.x, y: 2 * first.y - second.y },
    ...points,
    { x: 2 * last.x - beforeLast.x, y: 2 * last.y - beforeLast.y },
  ]
  const curve: Point[] = [first]
  for (let i = 1; i < all.length - 2; i++) {
    const p0 = all[i - 1] as Point
    const p1 = all[i] as Point
    const p2 = all[i + 1] as Point
    const p3 = all[i + 2] as Point
    const knot = (a: Point, b: Point) => Math.max(Math.hypot(b.x - a.x, b.y - a.y) ** 0.5, 1e-6)
    const t1 = knot(p0, p1)
    const t2 = t1 + knot(p1, p2)
    const t3 = t2 + knot(p2, p3)
    const steps = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / CURVE_STEP))
    for (let k = 1; k <= steps; k++) {
      const t = t1 + ((t2 - t1) * k) / steps
      const mix = (a: Point, b: Point, ta: number, tb: number) => ({
        x: ((tb - t) * a.x + (t - ta) * b.x) / (tb - ta),
        y: ((tb - t) * a.y + (t - ta) * b.y) / (tb - ta),
      })
      const a1 = mix(p0, p1, 0, t1)
      const a2 = mix(p1, p2, t1, t2)
      const a3 = mix(p2, p3, t2, t3)
      const b1 = mix(a1, a2, 0, t2)
      const b2 = mix(a2, a3, t1, t3)
      curve.push(mix(b1, b2, t1, t2))
    }
  }
  // Exactly on the last point, as on the first.
  curve[curve.length - 1] = last
  return curve
}

/** Makes the water along a line dearer to the ferries routed after it. */
function addTraffic(grid: WaterGrid, line: readonly Point[]): void {
  const reach = Math.ceil(LANE_REACH / CELL)
  const marked = new Set<number>()
  for (const point of line) {
    const column = Math.floor((point.x - grid.x0) / CELL)
    const row = Math.floor((point.y - grid.y0) / CELL)
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const c = column + dx
        const r = row + dy
        if (c < 0 || r < 0 || c >= grid.columns || r >= grid.rows) {
          continue
        }
        const cell = r * grid.columns + c
        const distance = Math.hypot(dx, dy) * CELL
        if (distance <= LANE_REACH && !marked.has(cell)) {
          marked.add(cell)
          grid.traffic[cell] = (grid.traffic[cell] ?? 0) + LANE_COST * (1 - distance / LANE_REACH)
        }
      }
    }
  }
}

/** Chaikin's corner cutting, a few rounds; a corner whose cut would touch land stays sharp. */
export function smoothed(grid: WaterGrid, points: Point[]): Point[] {
  let line = points
  for (let round = 0; round < CHAIKIN_ROUNDS; round++) {
    const next: Point[] = [line[0] as Point]
    for (let i = 1; i < line.length - 1; i++) {
      const before = line[i - 1] as Point
      const corner = line[i] as Point
      const after = line[i + 1] as Point
      const a = lerp(corner, before, 0.25)
      const b = lerp(corner, after, 0.25)
      if (clear(grid, a, b)) {
        next.push(a, b)
      } else {
        next.push(corner)
      }
    }
    next.push(line.at(-1) as Point)
    line = next
  }
  return line
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}
