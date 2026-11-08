import type { IslandShape } from '../terrain/island-shape'
import type { Point, Rect } from '../world/layout'

// Ferries sail on a grid of water cells: every cell whose centre stands on an island's land (its
// plateau, terraces and beach, a little more for the wake's own width) is closed. Water costs
// more near a shore, so that a line keeps off the beaches and takes to the open sea; and a little
// more among the islands than past them.

/** Side of a cell, in u. */
export const CELL = 1
/** Open water kept around the archipelago, past the widest beach. */
const SEA_MARGIN = 40
/** Within this distance of land, in u, water costs up to this much more. */
export const SHORE_REACH = 10
const SHORE_COST = 4
/** Among the islands, water costs this much more than on the open sea past them. */
const CHANNEL_COST = 0.5
/** Land is widened by this much: the line has a width of its own. */
const LAND_CLEARANCE = 0.3
/** How far a quay's tip may stand from free water, in cells. */
const START_SEARCH = 12

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

export function centreOf(grid: WaterGrid, cell: number): Point {
  return {
    x: grid.x0 + ((cell % grid.columns) + 0.5) * CELL,
    y: grid.y0 + (Math.floor(cell / grid.columns) + 0.5) * CELL,
  }
}

/** How far from land a point is, in u; 0 on land or off the grid. */
export function shoreAt(grid: WaterGrid, point: Point): number {
  const cell = cellAt(grid, point)
  return cell < 0 ? 0 : (grid.shore[cell] ?? 0)
}

/** Whether the straight line between two points stays on water, at least `margin` u off land. */
export function clear(grid: WaterGrid, a: Point, b: Point, margin = 0): boolean {
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
export function nearestWater(grid: WaterGrid, point: Point): number {
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
