import type { IslandShape } from './island-shape'
import type { Point, Rect } from './layout'

// Ferries leave their island for the open sea on a grid of water cells: every cell whose centre
// stands on an island's land (its plateau, terraces and beach, a little more for the wake's own
// width) is closed. Water near a shore costs more, so that a way out through a channel keeps to
// its middle. The ways out of every cell are found at once, as a tree grown from the open sea:
// two ferries that leave by one channel follow the same cells, and draw a single line there.

/** Side of a cell, in u. */
const CELL = 1
/** Open water kept around the archipelago, past the widest beach. */
const SEA_MARGIN = 40
/** Within this distance of land, in u, water costs up to this much more. */
const SHORE_REACH = 6
const SHORE_COST = 4
/** Land is widened by this much: the line has a width of its own. */
const LAND_CLEARANCE = 0.3
/** How far a quay's tip may stand from free water, in cells. */
const START_SEARCH = 12
const CHAIKIN_ROUNDS = 4
/** A way out is smoothed over this many cells each way. */
const SMOOTHING = 3

export interface WaterGrid {
  x0: number
  y0: number
  columns: number
  rows: number
  /** 1 where the cell is land. */
  land: Uint8Array
  /** Distance from each cell to land, in u. */
  shore: Float32Array
  /** Cost of crossing a cell, per u. */
  cost: Float32Array
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
  for (let cell = 0; cell < cost.length; cell++) {
    cost[cell] = 1 + SHORE_COST * Math.max(0, 1 - (shore[cell] ?? 0) / SHORE_REACH)
  }
  return { x0, y0, columns, rows, land, shore, cost }
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

/** The way to the open sea from every water cell inside `open`: each cell's next one. */
export interface SeaWays {
  grid: WaterGrid
  open: Rect
  /** The next cell toward the open sea; -1 past `open`, or where none leads out. */
  toward: Int32Array
}

/** The cheapest ways out of `open` to the open sea, grown from the sea inward. */
export function seaWays(grid: WaterGrid, open: Rect): SeaWays {
  const { columns, rows, land, cost } = grid
  const size = columns * rows
  const toward = new Int32Array(size).fill(-1)
  const spent = new Float64Array(size).fill(Number.POSITIVE_INFINITY)
  const done = new Uint8Array(size)
  const inside = insideOf(grid, open)
  const heap = new MinHeap()
  // From the water just past `open`, all around it.
  for (let cell = 0; cell < size; cell++) {
    if (land[cell] === 1 || inside(cell)) {
      continue
    }
    const column = cell % columns
    const row = Math.floor(cell / columns)
    const borders = NEIGHBOURS.some(([dx, dy]) => {
      const c = column + dx
      const r = row + dy
      return c >= 0 && r >= 0 && c < columns && r < rows && inside(r * columns + c)
    })
    if (borders) {
      spent[cell] = 0
      heap.push(cell, 0)
    }
  }
  while (heap.size > 0) {
    const cell = heap.pop()
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
      if (land[next] === 1 || !inside(next) || done[next] === 1) {
        continue
      }
      const diagonal = dx !== 0 && dy !== 0
      if (diagonal && (land[row * columns + c] === 1 || land[r * columns + column] === 1)) {
        continue
      }
      const step =
        (diagonal ? Math.SQRT2 : 1) * CELL * (((cost[cell] ?? 1) + (cost[next] ?? 1)) / 2)
      const total = (spent[cell] ?? 0) + step
      if (total < (spent[next] ?? Number.POSITIVE_INFINITY)) {
        spent[next] = total
        toward[next] = cell
        heap.push(next, total)
      }
    }
  }
  return { grid, open, toward }
}

/** Whether a cell lies inside a rectangle of the board. */
function insideOf(grid: WaterGrid, rect: Rect): (cell: number) => boolean {
  const c0 = Math.floor((rect.x - grid.x0) / CELL)
  const c1 = Math.floor((rect.x + rect.width - grid.x0) / CELL)
  const r0 = Math.floor((rect.y - grid.y0) / CELL)
  const r1 = Math.floor((rect.y + rect.height - grid.y0) / CELL)
  return (cell) => {
    const column = cell % grid.columns
    const row = Math.floor(cell / grid.columns)
    return column >= c0 && column <= c1 && row >= r0 && row <= r1
  }
}

/**
 * The way from `from` out to the open sea, smoothed, from the point itself to the first cell
 * past `open`; null if none leads out.
 */
export function seaWay(ways: SeaWays, from: Point): Point[] | null {
  const { grid, toward } = ways
  const start = nearestWater(grid, from)
  if (start < 0) {
    return null
  }
  const inside = insideOf(grid, ways.open)
  const cells = [start]
  for (let at = start; inside(at); ) {
    const next = toward[at] ?? -1
    if (next < 0) {
      return null
    }
    cells.push(next)
    at = next
  }
  const centres = cells.map((cell) => centreOf(grid, cell))
  // A moving average over the cells: it depends on the cells alone, so two ways that share
  // cells share their smoothed points too.
  const smooth = centres.map((point, index) => {
    if (index === 0 || index === centres.length - 1) {
      return point
    }
    const reach = Math.min(SMOOTHING, index, centres.length - 1 - index)
    let x = 0
    let y = 0
    for (let k = index - reach; k <= index + reach; k++) {
      x += centres[k]?.x ?? 0
      y += centres[k]?.y ?? 0
    }
    const average = { x: x / (2 * reach + 1), y: y / (2 * reach + 1) }
    return onLand(grid, average) ? point : average
  })
  return [from, ...smooth]
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
