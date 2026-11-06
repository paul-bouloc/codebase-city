import type { IslandShape } from './island-shape'
import type { Point, Rect } from './layout'

// Ferries sail on a grid of water cells: every cell whose centre stands on an island's land
// (its plateau, terraces and beach, a little more for the line's own width) is closed. The open
// sea around the archipelago is cheaper than its channels, so that a ferry goes round by the
// open sea when the detour is short, as the art direction draws them, and through the channels
// otherwise. Water near a shore costs more too: a line that hugged the beaches would read as the
// islands' outline. The path found is then pulled straight where it can, and rounded.

/** Side of a cell, in u. */
const CELL = 1
/** Open water kept around the archipelago, past the widest beach. */
const SEA_MARGIN = 40
/** A cell among the islands costs this much more than one on the open sea. */
const CHANNEL_COST = 3
/** Within this distance of land, in u, water costs up to this much more. */
const SHORE_REACH = 6
const SHORE_COST = 4
/** Land is widened by this much: the line has a width of its own. */
const LAND_CLEARANCE = 0.3
/** How far a quay's tip may stand from free water, in cells. */
const START_SEARCH = 12
const CHAIKIN_ROUNDS = 3

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
  const fromColumn = Math.max(0, Math.floor((inner.x - x0) / CELL))
  const toColumn = Math.min(columns, Math.ceil((inner.x + inner.width - x0) / CELL))
  const fromRow = Math.max(0, Math.floor((inner.y - y0) / CELL))
  const toRow = Math.min(rows, Math.ceil((inner.y + inner.height - y0) / CELL))
  for (let row = fromRow; row < toRow; row++) {
    for (let cell = row * columns + fromColumn; cell < row * columns + toColumn; cell++) {
      cost[cell] = (cost[cell] ?? 1) + CHANNEL_COST - 1
    }
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

/**
 * The cheapest way by water from `from` to `to`, rounded, from one point to the other; null if
 * none. Every point and segment of it stays off the land.
 */
export function waterRoute(grid: WaterGrid, from: Point, to: Point): Point[] | null {
  const start = nearestWater(grid, from)
  const goal = nearestWater(grid, to)
  if (start < 0 || goal < 0) {
    return null
  }
  const cells = search(grid, start, goal)
  if (!cells) {
    return null
  }
  const points = [from, ...cells.map((cell) => centreOf(grid, cell)), to]
  return rounded(grid, pulled(grid, points))
}

/** A* over the cells, eight ways, never cutting a corner of land. */
function search(grid: WaterGrid, start: number, goal: number): number[] | null {
  const { columns, rows, land, cost } = grid
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
      if (land[next] === 1) {
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

/** Chaikin's corner cutting, a few rounds; a corner whose cut would touch land stays sharp. */
function rounded(grid: WaterGrid, points: Point[]): Point[] {
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
