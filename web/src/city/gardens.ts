import { type CanalCell, ISLAND_MARGIN } from './canals'
import type { IslandLayout, Rect } from './layout'
import { LOT_SIZE } from './units'

// The room the layout leaves on a plateau, between its folders, its square and its canals,
// becomes gardens rather than bare paving: meadow slabs with trees. Small islands have the
// most, the minimum plateau (10 × 6.6 u) being larger than what a few files need.

/** A garden stands this far from the folders, square and canals around it: a paved street. */
const GARDEN_GAP = 0.9
/** Smaller room stays paved. */
const MIN_GARDEN = LOT_SIZE
const TOUCH = 0.01

const snap = (value: number) => Math.round(value * 100) / 100

/** The gardens of an island, given its canals: disjoint rectangles of its free plateau. */
export function islandGardens(island: IslandLayout, canals: readonly CanalCell[]): Rect[] {
  const { plateau } = island
  const inner: Rect = {
    x: plateau.x + ISLAND_MARGIN,
    y: plateau.y + ISLAND_MARGIN,
    width: plateau.width - 2 * ISLAND_MARGIN,
    height: plateau.height - 2 * ISLAND_MARGIN,
  }
  if (inner.width < MIN_GARDEN || inner.height < MIN_GARDEN) {
    return []
  }
  const half = LOT_SIZE / 2
  const folders = [
    ...island.parcels.filter((parcel) => parcel.level === 1).map((parcel) => parcel.rect),
    ...(island.square ? [island.square] : []),
  ]
  const obstacles: Rect[] = [
    ...folders,
    ...canals.map((cell) => cell.rect),
    // A lot outside every folder and the square: only in a city made up for development.
    ...island.lots
      .filter((lot) => !folders.some((rect) => contains(rect, lot.x, lot.y)))
      .map((lot) => ({ x: lot.x - half, y: lot.y - half, width: LOT_SIZE, height: LOT_SIZE })),
  ]

  // Cut the inner plateau along every edge, then mark the cells no obstacle covers.
  const cuts = (start: number, length: number, of: (rect: Rect) => [number, number]) => {
    const values = new Set([snap(start), snap(start + length)])
    for (const obstacle of obstacles) {
      for (const value of of(obstacle)) {
        if (value > start && value < start + length) {
          values.add(snap(value))
        }
      }
    }
    return [...values].sort((a, b) => a - b)
  }
  const xs = cuts(inner.x, inner.width, (rect) => [rect.x, rect.x + rect.width])
  const ys = cuts(inner.y, inner.height, (rect) => [rect.y, rect.y + rect.height])
  const columns = xs.length - 1
  const rows = ys.length - 1
  const free: boolean[] = []
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const cx = ((xs[column] ?? 0) + (xs[column + 1] ?? 0)) / 2
      const cy = ((ys[row] ?? 0) + (ys[row + 1] ?? 0)) / 2
      free.push(!obstacles.some((rect) => contains(rect, cx, cy)))
    }
  }

  // Greedy rectangles: as wide as the row allows, then as tall as every row below keeps free.
  const used = free.map((cell) => !cell)
  const at = (column: number, row: number) => row * columns + column
  const gardens: Rect[] = []
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (used[at(column, row)]) {
        continue
      }
      let right = column + 1
      while (right < columns && !used[at(right, row)]) {
        right++
      }
      let top = row + 1
      while (top < rows) {
        let clear = true
        for (let c = column; c < right; c++) {
          clear &&= !used[at(c, top)]
        }
        if (!clear) {
          break
        }
        top++
      }
      for (let r = row; r < top; r++) {
        for (let c = column; c < right; c++) {
          used[at(c, r)] = true
        }
      }
      const garden = withStreets(
        {
          x: xs[column] ?? 0,
          y: ys[row] ?? 0,
          width: (xs[right] ?? 0) - (xs[column] ?? 0),
          height: (ys[top] ?? 0) - (ys[row] ?? 0),
        },
        inner,
      )
      if (garden.width >= MIN_GARDEN - TOUCH && garden.height >= MIN_GARDEN - TOUCH) {
        gardens.push(garden)
      }
    }
  }
  return gardens
}

/** A garden on empty lots stays this far inside them: its neighbours' buildings keep their room. */
const LOT_INSET = 0.2

/**
 * The gardens of the island folder's own grid, on the paved plateau: its empty lots, merged in
 * rectangles, as wide as a row of them allows, then as tall as the rows above keep empty.
 * `isEmpty` tells a lot by its column and row.
 */
export function squareGardens(
  grid: Rect,
  isEmpty: (column: number, row: number) => boolean,
): Rect[] {
  const columns = Math.round(grid.width / LOT_SIZE)
  const rows = Math.round(grid.height / LOT_SIZE)
  const used = new Array<boolean>(columns * rows).fill(false)
  const free = (column: number, row: number) =>
    !used[row * columns + column] && isEmpty(column, row)
  const gardens: Rect[] = []
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (!free(column, row)) {
        continue
      }
      let right = column + 1
      while (right < columns && free(right, row)) {
        right++
      }
      let top = row + 1
      while (top < rows) {
        let clear = true
        for (let c = column; c < right && clear; c++) {
          clear = free(c, top)
        }
        if (!clear) {
          break
        }
        top++
      }
      for (let r = row; r < top; r++) {
        for (let c = column; c < right; c++) {
          used[r * columns + c] = true
        }
      }
      gardens.push({
        x: snap(grid.x + LOT_SIZE * column + LOT_INSET),
        y: snap(grid.y + LOT_SIZE * row + LOT_INSET),
        width: snap(LOT_SIZE * (right - column) - 2 * LOT_INSET),
        height: snap(LOT_SIZE * (top - row) - 2 * LOT_INSET),
      })
    }
  }
  return gardens
}

function contains(rect: Rect, x: number, y: number): boolean {
  return x > rect.x && x < rect.x + rect.width && y > rect.y && y < rect.y + rect.height
}

/** Steps back from every side but those on the island's margin, already paved. */
function withStreets(rect: Rect, inner: Rect): Rect {
  const gap = (onMargin: boolean) => (onMargin ? 0 : GARDEN_GAP)
  const west = gap(Math.abs(rect.x - inner.x) < TOUCH)
  const east = gap(Math.abs(rect.x + rect.width - (inner.x + inner.width)) < TOUCH)
  const south = gap(Math.abs(rect.y - inner.y) < TOUCH)
  const north = gap(Math.abs(rect.y + rect.height - (inner.y + inner.height)) < TOUCH)
  return {
    x: snap(rect.x + west),
    y: snap(rect.y + south),
    width: snap(rect.width - west - east),
    height: snap(rect.height - south - north),
  }
}
