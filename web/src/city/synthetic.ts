import { boundsOf, type CityLayout, type IslandLayout, type Point, type Rect } from './layout'
import { seededRandom } from './random'
import { LOT_SIZE, MAX_LAYER } from './units'

// A stand-in for the server's layout, to develop the engine without an analysis: rectangular
// islands of 2 u lots, packed in rows and separated by channels.

const LOT_MARGIN = 0.9
const MIN_LOT_COLUMNS = 5
const MIN_LOT_ROWS = 3

/** Water between two plateaux, from the shorter of their facing sides. */
export function channelWidth(facingSide: number): number {
  return Math.min(Math.max(0.22 * facingSide, 9), 24)
}

export interface SyntheticOptions {
  islands: number
  files: number
  seed?: string
}

interface Draft {
  path: string
  layer: number
  columns: number
  rows: number
  files: number
  width: number
  height: number
}

export function syntheticCity({
  islands,
  files,
  seed = 'synthetic',
}: SyntheticOptions): CityLayout {
  if (!Number.isInteger(islands) || islands < 1) {
    throw new RangeError(`islands must be a positive integer, got ${islands}`)
  }
  if (!Number.isInteger(files) || files < islands) {
    throw new RangeError(`files must be an integer of at least ${islands}, got ${files}`)
  }

  const drafts = splitFiles(files, islands, seed).map((count, index) => {
    const path = `module-${index + 1}`
    const random = seededRandom(`${seed}/${path}`)
    const layer = 1 + Math.floor(random() * MAX_LAYER)
    const aspect = 1 + random() * 0.8
    const columns = Math.max(MIN_LOT_COLUMNS, Math.ceil(Math.sqrt(count * aspect)))
    const rows = Math.max(MIN_LOT_ROWS, Math.ceil(count / columns))
    return {
      path,
      layer,
      columns,
      rows,
      files: count,
      width: columns * LOT_SIZE + 2 * LOT_MARGIN,
      height: rows * LOT_SIZE + 2 * LOT_MARGIN,
    }
  })

  const placed = packInRows(drafts)
  const bounds = boundsOf(placed.map((island) => island.plateau))
  const shiftX = -(bounds.x + bounds.width / 2)
  const shiftY = -(bounds.y + bounds.height / 2)
  const centred = placed.map((island) => ({
    ...island,
    plateau: { ...island.plateau, x: island.plateau.x + shiftX, y: island.plateau.y + shiftY },
    lots: island.lots.map((lot) => ({ x: lot.x + shiftX, y: lot.y + shiftY })),
  }))
  return {
    islands: centred,
    bounds: { ...bounds, x: bounds.x + shiftX, y: bounds.y + shiftY },
  }
}

/** Uneven shares that add up to `files`, at least one each. */
function splitFiles(files: number, islands: number, seed: string): number[] {
  const random = seededRandom(`${seed}/split`)
  const weights = Array.from({ length: islands }, () => 0.15 + random() ** 2)
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const spare = files - islands
  const shares = weights.map((weight) => 1 + Math.floor((spare * weight) / total))
  let left = files - shares.reduce((sum, share) => sum + share, 0)
  for (let i = 0; left > 0; i = (i + 1) % islands, left--) {
    shares[i] = (shares[i] ?? 0) + 1
  }
  return shares
}

/** Largest first, left to right, in rows about as wide as the city is tall. */
function packInRows(drafts: Draft[]): IslandLayout[] {
  const order = [...drafts].sort((a, b) => b.width * b.height - a.width * a.height)
  const area = order.reduce((sum, d) => sum + (d.width + 9) * (d.height + 9), 0)
  const rowWidth = Math.sqrt(area) * 1.2

  const rows: Draft[][] = []
  let current: Draft[] = []
  let x = 0
  for (const draft of order) {
    const previous = current.at(-1)
    const gap = previous ? channelWidth(Math.min(previous.height, draft.height)) : 0
    if (previous && x + gap + draft.width > rowWidth) {
      rows.push(current)
      current = []
      x = 0
    }
    x += (current.length > 0 ? gap : 0) + draft.width
    current.push(draft)
  }
  rows.push(current)

  const islands: IslandLayout[] = []
  let y = 0
  rows.forEach((row, index) => {
    const next = rows[index + 1] ?? []
    let left = 0
    row.forEach((draft, column) => {
      const before = row[column - 1]
      if (before) {
        left += before.width + channelWidth(Math.min(before.height, draft.height))
      }
      const plateau = { x: left, y, width: draft.width, height: draft.height }
      islands.push({
        path: draft.path,
        layer: draft.layer,
        plateau,
        lots: lotCentres(draft, plateau),
      })
    })
    // Any island of this row may face any island of the next: keep the widest channel needed.
    const widest = Math.max(...row.map((d) => d.width), ...next.map((d) => d.width))
    y += Math.max(...row.map((d) => d.height)) + channelWidth(widest)
  })
  return islands.sort((a, b) => a.path.localeCompare(b.path, 'en', { numeric: true }))
}

function lotCentres(draft: Draft, plateau: Rect): Point[] {
  return Array.from({ length: draft.files }, (_, index) => ({
    x: plateau.x + LOT_MARGIN + ((index % draft.columns) + 0.5) * LOT_SIZE,
    y: plateau.y + LOT_MARGIN + (Math.floor(index / draft.columns) + 0.5) * LOT_SIZE,
  }))
}
