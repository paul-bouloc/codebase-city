import type { Side } from './island-shape'
import type { IslandLayout, Rect } from './layout'

// Canals run in the gaps the layout leaves between an island's folders (1.8 u). The plateau,
// less its margin, is cut along every edge of those folders into cells; a free cell is a canal
// when it lies between two folders about a canal's width apart, or where two canals cross.
// Strips left along a grid, and room left at the end of a row, stay paved.

/** Paving between the plateau's edge and its folders. */
export const ISLAND_MARGIN = 0.9
/** The quay along each bank: the water is the gap less a quay on each side. */
export const QUAY_WIDTH = 0.3
/** Gaps of this width, in u, are canals: the layout leaves 1.8 u between two folders. */
const CANAL_GAP = [1.5, 2.1] as const
/** A canal at least this long gets a footbridge halfway along. */
export const FOOTBRIDGE_RUN = 6

export interface CanalCell {
  rect: Rect
  /** The banks with a quay; a side toward more canal has none. */
  quays: Record<Side, boolean>
  /** The side where the canal reaches the plateau's margin and pours over the edge. */
  mouth?: Side
}

export interface Footbridge {
  /** The deck, from bank to bank. */
  rect: Rect
}

export interface Canals {
  cells: CanalCell[]
  footbridges: Footbridge[]
}

const NONE: Canals = { cells: [], footbridges: [] }

/** Rounds to a hundredth of a unit, so that edges from different folders line up. */
const snap = (value: number) => Math.round(value * 100) / 100

const isCanalGap = (width: number) => width >= CANAL_GAP[0] && width <= CANAL_GAP[1]

export function islandCanals(island: IslandLayout): Canals {
  const obstacles = island.parcels
    .filter((parcel) => parcel.level === 1)
    .map((parcel) => parcel.rect)
  if (island.square) {
    obstacles.push(island.square)
  }
  if (obstacles.length < 2) {
    return NONE
  }
  const { plateau } = island
  const left = snap(plateau.x + ISLAND_MARGIN)
  const right = snap(plateau.x + plateau.width - ISLAND_MARGIN)
  const bottom = snap(plateau.y + ISLAND_MARGIN)
  const top = snap(plateau.y + plateau.height - ISLAND_MARGIN)
  const edges = (from: number, to: number, values: number[]) =>
    [...new Set([from, to, ...values.map(snap)])]
      .filter((value) => value >= from && value <= to)
      .sort((a, b) => a - b)
  const xs = edges(
    left,
    right,
    obstacles.flatMap((rect) => [rect.x, rect.x + rect.width]),
  )
  const ys = edges(
    bottom,
    top,
    obstacles.flatMap((rect) => [rect.y, rect.y + rect.height]),
  )
  const columns = xs.length - 1
  const rows = ys.length - 1
  const at = (column: number, row: number) => row * columns + column
  const width = (column: number) => snap((xs[column + 1] ?? 0) - (xs[column] ?? 0))
  const height = (row: number) => snap((ys[row + 1] ?? 0) - (ys[row] ?? 0))

  // Which cells a folder covers.
  const blocked = new Uint8Array(columns * rows)
  const index = (values: number[], value: number) => values.indexOf(snap(value))
  for (const rect of obstacles) {
    const c0 = Math.max(index(xs, rect.x), 0)
    const c1 = index(xs, rect.x + rect.width)
    const r0 = Math.max(index(ys, rect.y), 0)
    const r1 = index(ys, rect.y + rect.height)
    for (let row = r0; row < (r1 < 0 ? rows : r1); row++) {
      for (let column = c0; column < (c1 < 0 ? columns : c1); column++) {
        blocked[at(column, row)] = 1
      }
    }
  }
  const free = (column: number, row: number) =>
    column >= 0 && column < columns && row >= 0 && row < rows && !blocked[at(column, row)]

  /**
   * The free run through a cell along one axis: its length, and whether folders close it at
   * both ends (and not the plateau's margin).
   */
  const run = (column: number, row: number, dx: boolean) => {
    let first = dx ? column : row
    let last = first
    while (dx ? free(first - 1, row) : free(column, first - 1)) {
      first--
    }
    while (dx ? free(last + 1, row) : free(column, last + 1)) {
      last++
    }
    const values = dx ? xs : ys
    const count = dx ? columns : rows
    return {
      length: snap((values[last + 1] ?? 0) - (values[first] ?? 0)),
      closed: first > 0 && last < count - 1,
    }
  }

  // Water runs along y where folders close a canal's width across x, and the other way round.
  const canal = new Uint8Array(columns * rows)
  const ALONG_Y = 1
  const ALONG_X = 2
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (!free(column, row)) {
        continue
      }
      const across = run(column, row, true)
      const down = run(column, row, false)
      const value =
        (across.closed && isCanalGap(across.length) ? ALONG_Y : 0) |
        (down.closed && isCanalGap(down.length) ? ALONG_X : 0)
      canal[at(column, row)] = value
    }
  }
  // Crossings: a canal-sized cell between canals on two sides.
  const isCanal = (column: number, row: number) =>
    column >= 0 && column < columns && row >= 0 && row < rows && canal[at(column, row)] !== 0
  const crossings: number[] = []
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (
        !free(column, row) ||
        isCanal(column, row) ||
        !isCanalGap(width(column)) ||
        !isCanalGap(height(row))
      ) {
        continue
      }
      const neighbours = [
        isCanal(column - 1, row),
        isCanal(column + 1, row),
        isCanal(column, row - 1),
        isCanal(column, row + 1),
      ].filter(Boolean).length
      if (neighbours >= 2) {
        crossings.push(at(column, row))
      }
    }
  }
  for (const cell of crossings) {
    canal[cell] = ALONG_X | ALONG_Y
  }

  const cells: CanalCell[] = []
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const kind = canal[at(column, row)] ?? 0
      if (!kind) {
        continue
      }
      const rect = {
        x: xs[column] ?? 0,
        y: ys[row] ?? 0,
        width: width(column),
        height: height(row),
      }
      // A canal reaching the margin along its own direction pours out there.
      let mouth: Side | undefined
      if (kind & ALONG_Y && row === 0) {
        mouth = 'south'
      } else if (kind & ALONG_Y && row === rows - 1) {
        mouth = 'north'
      } else if (kind & ALONG_X && column === 0) {
        mouth = 'west'
      } else if (kind & ALONG_X && column === columns - 1) {
        mouth = 'east'
      }
      cells.push({
        rect,
        quays: {
          west: !isCanal(column - 1, row) && mouth !== 'west',
          east: !isCanal(column + 1, row) && mouth !== 'east',
          south: !isCanal(column, row - 1) && mouth !== 'south',
          north: !isCanal(column, row + 1) && mouth !== 'north',
        },
        ...(mouth ? { mouth } : {}),
      })
    }
  }

  return { cells, footbridges: footbridges(cells) }
}

/**
 * One footbridge halfway along each long enough stretch of canal, on a cell with a quay on
 * both banks: never over a crossing.
 */
function footbridges(cells: CanalCell[]): Footbridge[] {
  const bridges: Footbridge[] = []
  for (const alongY of [true, false]) {
    // Stretches: cells of one column (or row) that follow each other, banked on both sides.
    const banked = cells.filter((cell) =>
      alongY ? cell.quays.west && cell.quays.east : cell.quays.south && cell.quays.north,
    )
    const key = (cell: CanalCell) => (alongY ? cell.rect.x : cell.rect.y)
    const start = (cell: CanalCell) => (alongY ? cell.rect.y : cell.rect.x)
    const end = (cell: CanalCell) =>
      alongY ? cell.rect.y + cell.rect.height : cell.rect.x + cell.rect.width
    const byLine = new Map<number, CanalCell[]>()
    for (const cell of cells) {
      const line = byLine.get(key(cell)) ?? []
      line.push(cell)
      byLine.set(key(cell), line)
    }
    for (const line of byLine.values()) {
      line.sort((a, b) => start(a) - start(b))
      // Split the line where it stops: a gap, or a cell running the other way.
      let stretch: CanalCell[] = []
      const close = () => {
        const length = stretch.reduce((sum, cell) => sum + end(cell) - start(cell), 0)
        const first = stretch[0]
        if (first && length >= FOOTBRIDGE_RUN) {
          const middle = start(first) + length / 2
          const candidates = stretch.filter((cell) => banked.includes(cell))
          const cell = candidates.sort(
            (a, b) =>
              Math.abs((start(a) + end(a)) / 2 - middle) -
              Math.abs((start(b) + end(b)) / 2 - middle),
          )[0]
          if (cell) {
            const centre = Math.min(Math.max(middle, start(cell) + 0.3), end(cell) - 0.3)
            bridges.push({
              rect: alongY
                ? { x: cell.rect.x, y: centre - 0.3, width: cell.rect.width, height: 0.6 }
                : { x: centre - 0.3, y: cell.rect.y, width: 0.6, height: cell.rect.height },
            })
          }
        }
        stretch = []
      }
      for (const cell of line) {
        const runsThisWay = alongY ? isCanalGap(cell.rect.width) : isCanalGap(cell.rect.height)
        const previous = stretch.at(-1)
        if (!runsThisWay || (previous && Math.abs(end(previous) - start(cell)) > 1e-6)) {
          close()
        }
        if (runsThisWay) {
          stretch.push(cell)
        }
      }
      close()
    }
  }
  return bridges
}
