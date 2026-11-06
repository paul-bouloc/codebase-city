import type { IslandShape } from './island-shape'
import type { Point, Rect } from './layout'

// Ferries sail on a grid of water cells: every cell whose centre stands on an island's land (its
// plateau, terraces and beach, a little more for the wake's own width) is closed. Water costs
// more near a shore, so that a line keeps off the beaches and takes to the open sea; a little
// more among the islands than past them; and more again where another ferry already sails, so
// that lines run side by side rather than over one another. The way found is then cut down to
// the few turns it needs, and a smooth curve drawn through them: wide bends, not corners.

/** Side of a cell, in u. */
const CELL = 1
/** Open water kept around the archipelago, past the widest beach. */
const SEA_MARGIN = 40
/** Within this distance of land, in u, water costs up to this much more. */
const SHORE_REACH = 10
const SHORE_COST = 4
/** Among the islands, water costs this much more than on the open sea past them. */
const CHANNEL_COST = 0.5
/** Around a ferry's line, within this distance, water costs this much more to the next ones. */
const LANE_REACH = 2.5
const LANE_COST = 3
/** A ferry leaves its pier straight out for this far before it turns. */
const DEPARTURE = 5
/** Points along the smooth curve, about this far apart. */
const CURVE_STEP = 1
/** Land is widened by this much: the line has a width of its own. */
const LAND_CLEARANCE = 0.3
/** How far a quay's tip may stand from free water, in cells. */
const START_SEARCH = 12
const CHAIKIN_ROUNDS = 4

export interface WaterGrid {
  x0: number
  y0: number
  columns: number
  rows: number
  /** 1 where the cell is land. */
  land: Uint8Array
  /** Distance from each cell to land, in u. */
  shore: Float32Array
  /** Cost of crossing a cell, per u: the water itself, then the ferries already there. */
  cost: Float32Array
  traffic: Float32Array
}

/** The outline of an island's land, its beach's outer edge, pushed `margin` u further out. */
export function landOutline(shape: IslandShape, margin = 0): Point[] {
  return shape.samples.map((sample) => {
    const out = (sample.offsets.at(-1) ?? 0) + margin
    return { x: sample.x + sample.nx * out, y: sample.y + sample.ny * out }
  })
}

/** Whether a point stands inside a polygon (even-odd rule). */
export function insidePolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i] as Point
    const b = polygon[j] as Point
    if (a.y > point.y !== b.y > point.y) {
      const x = a.x + ((point.y - a.y) * (b.x - a.x)) / (b.y - a.y)
      if (point.x < x) {
        inside = !inside
      }
    }
  }
  return inside
}

/** The water around and between the islands, `inner` being the archipelago's plateaux. */
export function waterGrid(shapes: readonly IslandShape[], inner: Rect): WaterGrid {
  const x0 = inner.x - SEA_MARGIN
  const y0 = inner.y - SEA_MARGIN
  const columns = Math.ceil((inner.width + 2 * SEA_MARGIN) / CELL)
  const rows = Math.ceil((inner.height + 2 * SEA_MARGIN) / CELL)
  const land = new Uint8Array(columns * rows)
  for (const shape of shapes) {
    fillPolygon(land, columns, rows, x0, y0, landOutline(shape, LAND_CLEARANCE))
  }
  const shore = distanceToLand(land, columns, rows)
  const cost = new Float32Array(columns * rows)
  const c0 = Math.floor((inner.x - x0) / CELL)
  const c1 = Math.floor((inner.x + inner.width - x0) / CELL)
  const r0 = Math.floor((inner.y - y0) / CELL)
  const r1 = Math.floor((inner.y + inner.height - y0) / CELL)
  for (let cell = 0; cell < cost.length; cell++) {
    const column = cell % columns
    const row = Math.floor(cell / columns)
    const among = column >= c0 && column <= c1 && row >= r0 && row <= r1
    cost[cell] =
      1 +
      SHORE_COST * Math.max(0, 1 - (shore[cell] ?? 0) / SHORE_REACH) +
      (among ? CHANNEL_COST : 0)
  }
  return { x0, y0, columns, rows, land, shore, cost, traffic: new Float32Array(columns * rows) }
}

/** Distance from each cell to the nearest land cell, in u: a two-pass chamfer (3-4). */
function distanceToLand(land: Uint8Array, columns: number, rows: number): Float32Array {
  const far = 3 * (columns + rows)
  const distance = new Float32Array(columns * rows)
  for (let cell = 0; cell < distance.length; cell++) {
    distance[cell] = land[cell] === 1 ? 0 : far
  }
  const relax = (cell: number, column: number, row: number, dx: number, dy: number, w: number) => {
    const c = column + dx
    const r = row + dy
    if (c >= 0 && r >= 0 && c < columns && r < rows) {
      const through = (distance[r * columns + c] ?? far) + w
      if (through < (distance[cell] ?? far)) {
        distance[cell] = through
      }
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const cell = row * columns + column
      relax(cell, column, row, -1, 0, 3)
      relax(cell, column, row, 0, -1, 3)
      relax(cell, column, row, -1, -1, 4)
      relax(cell, column, row, 1, -1, 4)
    }
  }
  for (let row = rows - 1; row >= 0; row--) {
    for (let column = columns - 1; column >= 0; column--) {
      const cell = row * columns + column
      relax(cell, column, row, 1, 0, 3)
      relax(cell, column, row, 0, 1, 3)
      relax(cell, column, row, 1, 1, 4)
      relax(cell, column, row, -1, 1, 4)
    }
  }
  for (let cell = 0; cell < distance.length; cell++) {
    distance[cell] = ((distance[cell] ?? 0) * CELL) / 3
  }
  return distance
}

/** Closes every cell whose centre is inside the polygon, row by row. */
function fillPolygon(
  land: Uint8Array,
  columns: number,
  rows: number,
  x0: number,
  y0: number,
  polygon: readonly Point[],
): void {
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of polygon) {
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }
  const firstRow = Math.max(0, Math.ceil((minY - y0) / CELL - 0.5))
  const lastRow = Math.min(rows - 1, Math.floor((maxY - y0) / CELL - 0.5))
  const crossings: number[] = []
  for (let row = firstRow; row <= lastRow; row++) {
    const y = y0 + (row + 0.5) * CELL
    crossings.length = 0
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i] as Point
      const b = polygon[j] as Point
      if (a.y > y !== b.y > y) {
        crossings.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y))
      }
    }
    crossings.sort((a, b) => a - b)
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil(((crossings[k] ?? 0) - x0) / CELL - 0.5))
      const to = Math.min(columns - 1, Math.floor(((crossings[k + 1] ?? 0) - x0) / CELL - 0.5))
      if (to >= from) {
        land.fill(1, row * columns + from, row * columns + to + 1)
      }
    }
  }
}

function cellAt(grid: WaterGrid, point: Point): number {
  const column = Math.floor((point.x - grid.x0) / CELL)
  const row = Math.floor((point.y - grid.y0) / CELL)
  if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) {
    return -1
  }
  return row * grid.columns + column
}

/** Whether a point is on land, or off the grid. */
export function onLand(grid: WaterGrid, point: Point): boolean {
  const cell = cellAt(grid, point)
  return cell < 0 || grid.land[cell] === 1
}

function centreOf(grid: WaterGrid, cell: number): Point {
  return {
    x: grid.x0 + ((cell % grid.columns) + 0.5) * CELL,
    y: grid.y0 + (Math.floor(cell / grid.columns) + 0.5) * CELL,
  }
}

/** How far from land a point is, in u; 0 on land or off the grid. */
function shoreAt(grid: WaterGrid, point: Point): number {
  const cell = cellAt(grid, point)
  return cell < 0 ? 0 : (grid.shore[cell] ?? 0)
}

/** Whether the straight line between two points stays on water, at least `margin` u off land. */
function clear(grid: WaterGrid, a: Point, b: Point, margin = 0): boolean {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (CELL / 4))
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps
    const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    if (onLand(grid, point) || shoreAt(grid, point) < margin) {
      return false
    }
  }
  return true
}

/** The water cell nearest a point, if one is close. */
function nearestWater(grid: WaterGrid, point: Point): number {
  const start = cellAt(grid, point)
  if (start >= 0 && grid.land[start] === 0) {
    return start
  }
  const column = Math.floor((point.x - grid.x0) / CELL)
  const row = Math.floor((point.y - grid.y0) / CELL)
  let best = -1
  let bestDistance = Number.POSITIVE_INFINITY
  for (let dy = -START_SEARCH; dy <= START_SEARCH; dy++) {
    for (let dx = -START_SEARCH; dx <= START_SEARCH; dx++) {
      const c = column + dx
      const r = row + dy
      if (c < 0 || r < 0 || c >= grid.columns || r >= grid.rows) {
        continue
      }
      const cell = r * grid.columns + c
      const distance = dx * dx + dy * dy
      if (grid.land[cell] === 0 && distance < bestDistance) {
        best = cell
        bestDistance = distance
      }
    }
  }
  return best
}

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
 * routed after it.
 */
export function ferryRoute(
  grid: WaterGrid,
  from: Point,
  fromNormal: Point,
  to: Point,
  toNormal: Point,
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
  addTraffic(grid, line)
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

/** A binary heap of cells by priority. */
class MinHeap {
  private readonly cells: number[] = []
  private readonly priorities: number[] = []

  get size(): number {
    return this.cells.length
  }

  push(cell: number, priority: number): void {
    const { cells, priorities } = this
    let at = cells.length
    cells.push(cell)
    priorities.push(priority)
    while (at > 0) {
      const parent = (at - 1) >> 1
      if ((priorities[parent] ?? 0) <= priority) {
        break
      }
      cells[at] = cells[parent] ?? 0
      priorities[at] = priorities[parent] ?? 0
      at = parent
    }
    cells[at] = cell
    priorities[at] = priority
  }

  pop(): number {
    const { cells, priorities } = this
    const top = cells[0] ?? -1
    const lastCell = cells.pop() ?? 0
    const lastPriority = priorities.pop() ?? 0
    const size = cells.length
    if (size === 0) {
      return top
    }
    let at = 0
    for (;;) {
      const left = 2 * at + 1
      if (left >= size) {
        break
      }
      const right = left + 1
      const child =
        right < size && (priorities[right] ?? 0) < (priorities[left] ?? 0) ? right : left
      if ((priorities[child] ?? 0) >= lastPriority) {
        break
      }
      cells[at] = cells[child] ?? 0
      priorities[at] = priorities[child] ?? 0
      at = child
    }
    cells[at] = lastCell
    priorities[at] = lastPriority
    return top
  }
}
