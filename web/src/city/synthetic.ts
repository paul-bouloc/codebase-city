import type { Language } from '../ui/Badge'
import {
  boundsOf,
  type CityLayout,
  type FileMetrics,
  type IslandLayout,
  type IslandLink,
  type Lot,
  type Rect,
} from './layout'
import { seededRandom } from './random'
import { LOT_SIZE, MAX_LAYER } from './units'

// A stand-in for the server's layout, to develop the engine without an analysis: rectangular
// islands of 2 u lots, packed in rows and separated by channels.

const LOT_MARGIN = 0.9
const MIN_LOT_COLUMNS = 5
const MIN_LOT_ROWS = 3

/** Water between two plateaux, from the shorter of their facing sides, as the analyzer does. */
export function channelWidth(facingSide: number): number {
  return Math.min(Math.max(0.22 * facingSide, 14), 24)
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
  files: FileMetrics[]
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
      files: Array.from({ length: count }, (_, file) => syntheticFile(`${seed}/${path}/${file}`)),
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
    lots: island.lots.map((lot) => ({ ...lot, x: lot.x + shiftX, y: lot.y + shiftY })),
  }))
  return {
    islands: centred,
    bounds: { ...bounds, x: bounds.x + shiftX, y: bounds.y + shiftY },
    links: syntheticLinks(centred, seed),
  }
}

/** Shares of island pairs that import each other: down the layers, within one, and up. */
const LINK_SHARES = { down: 0.3, level: 0.2, up: 0.04 }

/** Imports mostly down the layers, some within a layer, a few up: every kind of link. */
function syntheticLinks(islands: readonly IslandLayout[], seed: string): IslandLink[] {
  const random = seededRandom(`${seed}/links`)
  const links: IslandLink[] = []
  islands.forEach((from, a) => {
    islands.forEach((to, b) => {
      if (a === b) {
        return
      }
      const share =
        from.layer > to.layer
          ? LINK_SHARES.down
          : from.layer === to.layer
            ? LINK_SHARES.level / 2
            : LINK_SHARES.up
      if (random() < share) {
        const imports = Math.max(1, Math.round(300 * random() ** 3))
        links.push({ from: a, to: b, imports, upward: from.layer < to.layer ? imports : 0 })
      }
    })
  })
  return links
}

/**
 * A city with import cycles across islands, to see how their ways are outlined: two neighbours
 * on one layer, face to face across a channel, import each other heavily, so a bridge spans it,
 * and their first files make a loop; the first files of three other islands make another, along
 * whatever joins them, its last link too small to draw. The links of the pairs it uses are
 * replaced, so that none adds up with them; the links added never go up the layers.
 */
export function withCrossingCycles(layout: CityLayout): CityLayout {
  const islands = layout.islands.map((island) => ({ ...island }))
  const neighbours = facingPair(islands)
  if (!neighbours) {
    return layout
  }
  const [near, across] = neighbours
  const nearIsland = islands[near] as IslandLayout
  islands[across] = { ...(islands[across] as IslandLayout), layer: nearIsland.layer }
  const others = islands
    .map((_, index) => index)
    .filter((index) => index !== near && index !== across)
  const [first, second, third] = others
  const pairKey = (a: number, b: number) => `${Math.min(a, b)}/${Math.max(a, b)}`
  const used = new Set([pairKey(near, across)])
  if (first !== undefined && second !== undefined && third !== undefined) {
    used.add(pairKey(first, second)).add(pairKey(second, third)).add(pairKey(third, first))
  }
  // The others keep their imports; those of `across` go up the layers by its new one.
  const layerOf = (island: number) => islands[island]?.layer ?? 1
  const links: IslandLink[] = (layout.links ?? [])
    .filter((link) => !used.has(pairKey(link.from, link.to)))
    .map((link) => ({
      ...link,
      upward: layerOf(link.from) < layerOf(link.to) ? link.imports : 0,
    }))
  const largest = Math.max(1, ...links.map((link) => link.imports))
  const add = (from: number, to: number, imports: number) =>
    links.push({ from, to, imports, upward: 0 })
  add(near, across, 4 * largest)
  add(across, near, largest)
  const cycles: CityLayout['cycles'] = [
    {
      members: [
        { island: near, lot: 0 },
        { island: across, lot: 0 },
      ],
      loop: [0, 1],
      imports: [
        [0, 1],
        [1, 0],
      ],
    },
  ]
  if (first !== undefined && second !== undefined && third !== undefined) {
    add(first, second, largest)
    add(second, third, largest)
    // Under 1 % of the largest: left undrawn while nothing is selected.
    add(third, first, 1)
    cycles.push({
      members: [
        { island: first, lot: 0 },
        { island: second, lot: 0 },
        { island: third, lot: 0 },
      ],
      loop: [0, 1, 2],
      imports: [
        [0, 1],
        [1, 2],
        [2, 0],
      ],
    })
  }
  return { ...layout, islands, links, cycles }
}

/** Two islands face to face across one channel at most 24 u wide, the largest first. */
function facingPair(islands: readonly IslandLayout[]): [number, number] | null {
  for (let a = 0; a < islands.length; a++) {
    for (let b = a + 1; b < islands.length; b++) {
      const p = (islands[a] as IslandLayout).plateau
      const q = (islands[b] as IslandLayout).plateau
      const overlapY = Math.min(p.y + p.height, q.y + q.height) - Math.max(p.y, q.y)
      const overlapX = Math.min(p.x + p.width, q.x + q.width) - Math.max(p.x, q.x)
      const gapX = Math.max(q.x - (p.x + p.width), p.x - (q.x + q.width))
      const gapY = Math.max(q.y - (p.y + p.height), p.y - (q.y + q.height))
      if ((overlapY > 12 && gapX > 0 && gapX <= 24) || (overlapX > 12 && gapY > 0 && gapY <= 24)) {
        return [a, b]
      }
    }
  }
  return null
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
        parcels: [],
        lots: lotsOf(draft, plateau),
      })
    })
    // Any island of this row may face any island of the next: keep the widest channel needed.
    const widest = Math.max(...row.map((d) => d.width), ...next.map((d) => d.width))
    y += Math.max(...row.map((d) => d.height)) + channelWidth(widest)
  })
  return islands.sort((a, b) => a.path.localeCompare(b.path, 'en', { numeric: true }))
}

function lotsOf(draft: Draft, plateau: Rect): Lot[] {
  return draft.files.map((file, index) => ({
    x: plateau.x + LOT_MARGIN + ((index % draft.columns) + 0.5) * LOT_SIZE,
    y: plateau.y + LOT_MARGIN + (Math.floor(index / draft.columns) + 0.5) * LOT_SIZE,
    file,
  }))
}

const LANGUAGES: readonly [Language, number][] = [
  ['typescript', 0.55],
  ['javascript', 0.15],
  ['css', 0.12],
  ['other', 0.18],
]

/**
 * Lines spread from 10 to 3,000, most files short; complexity per line varies a lot, and data
 * files (`other`) have almost none, so that long, simple files exist.
 */
function syntheticFile(seed: string): FileMetrics {
  const random = seededRandom(seed)
  const test = random() < 0.1
  let pick = random()
  const language =
    LANGUAGES.find(([, share]) => {
      pick -= share
      return pick < 0
    })?.[0] ?? 'other'
  const lines = Math.round(10 * 300 ** (random() ** 1.6))
  const density = language === 'other' && random() < 0.5 ? 0.001 : 0.01 + 0.08 * random() ** 2
  // A third of the `other` files are in a language the analyzer does not read: concrete
  const analyzed = !(language === 'other' && random() < 1 / 3)
  return {
    // The seed names the file: its building draws its own pieces
    path: seed,
    language,
    lines,
    complexity: Math.max(1, Math.round(lines * density)),
    test,
    analyzed,
  }
}
