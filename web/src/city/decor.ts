import { type CanalCell, islandCanals } from './canals'
import { islandGardens, squareGardens } from './gardens'
import type { IslandShape } from './island-shape'
import type { CityLayout, IslandLayout, ParcelNature, Point, Rect } from './layout'
import { seededRandom } from './random'
import { LOT_SIZE, layerAltitude, slabTop } from './units'

// The decor says nothing about the files, but follows their ground: a park of tests has more
// trees than an ordinary parcel, concrete has none. Every tree and rock is drawn from a seed of
// its island and its place: the city never changes between visits.

export type TreeKind = 'conifer' | 'round'

export interface Tree {
  /** The foot of the trunk, in board coordinates; `z` is the ground under it. */
  x: number
  y: number
  z: number
  kind: TreeKind
  /** The design's `s`, 0.7 to 1.2. */
  size: number
  /** Turn about the vertical, in radians. */
  angle: number
  /** One of the four foliage tints. */
  foliage: number
  /** In [0, 1): staggers the moment each tree shrinks away. */
  seed: number
}

export interface Rock {
  x: number
  y: number
  radius: number
  angle: number
  seed: number
}

/** A meadow slab on the free room of a plateau or the empty lots of its square, in u. */
export interface Garden {
  rect: Rect
  bottom: number
  top: number
}

export interface Decor {
  trees: Tree[]
  rocks: Rock[]
  gardens: Garden[]
}

export const FOLIAGE_TINTS = ['#5E9E6E', '#7BB06A', '#4E8862', '#93B65C'] as const

/** Crown radius for `size` 1: the round tree's lower tier, the conifer's cone. */
export const CROWN_RADIUS: Record<TreeKind, number> = { round: 0.44, conifer: 0.42 }

const SIZES = [0.7, 1.2] as const
/** Trees scatter ±0.65 u around a lot's centre, their crowns 0.1 u inside it. */
const LOT_SCATTER = 0.65
const LOT_ROOM = LOT_SIZE / 2 - 0.1
/** Two crowns in one lot may overlap this much of their radii, no more. */
const CROWN_OVERLAP = 0.7
const PLACEMENT_TRIES = 12
/** Conifers in lots and gardens; the design gives 60 % on the flanks only. */
const LOT_CONIFERS = 0.3
const FLANK_CONIFERS = 0.6

/** Trees on 40 % of a terrace's contour points, 35 to 75 % of the way across. */
const FLANK_SHARE = 0.4
const FLANK_ACROSS = [0.35, 0.75] as const
/** Each one slides along the contour, so that they never stand in file. */
const FLANK_SLIDE = 0.6
/** A terrace narrower than this has no tree: its cliff would be all there is. */
const MIN_FLANK_WIDTH = 0.8
/** Rocks on 22 % of the shore's points, 0.25 to 0.6 u. */
const ROCK_SHARE = 0.22
const ROCK_RADII = [0.25, 0.6] as const
/** No tree nor rock this close to a cascade, measured on the plateau's edge. */
const CASCADE_CLEARANCE = 1.5 + 0.38

/**
 * At most this many trees in the empty lots of a city's folders. The layout's stretch leaves
 * many more empty lots than the design's 13 % (vscode: 56 %, 52,000 trees and 1.5 M triangles);
 * past the budget, only a share of them is wooded, the others stay meadow, clearings.
 */
const LOT_TREE_BUDGET = 16_000
/** Trees an empty lot gets on average: 1 to 3 on a meadow, 2 or 3 in a park of tests. */
const MEAN_TREES: Record<ParcelNature, number> = { normal: 2, tests: 2.5, unanalyzed: 0 }

/**
 * A small city has twice the decor: trees on every empty lot and garden lot, one more in each
 * (3 at most), and twice the trees and rocks along its shores.
 */
const SMALL_CITY = 50
const MAX_LOT_TREES = 3

/** The decor of a city, from its layout and its islands' terrain (in the same order). */
export function cityDecor(layout: CityLayout, shapes: readonly IslandShape[]): Decor {
  const files = layout.islands.reduce((sum, island) => sum + island.lots.length, 0)
  const small = files < SMALL_CITY
  const decor: Decor = { trees: [], rocks: [], gardens: [] }
  let expected = 0
  for (const island of layout.islands) {
    const lots = lotGrids(island)
    for (const grid of lots.filter((each) => !each.grid.square)) {
      expected += grid.empty().length * MEAN_TREES[grid.grid.nature]
    }
  }
  const wooded = Math.min(1, LOT_TREE_BUDGET / Math.max(expected, 1))
  layout.islands.forEach((island, index) => {
    const canals = islandCanals(island).cells
    const altitude = layerAltitude(island.layer)
    addLotTrees(decor, island, altitude, small, wooded)
    for (const rect of islandGardens(island, canals)) {
      addGarden(decor, island, { rect, bottom: altitude, top: altitude + slabTop(1) }, small)
    }
    const shape = shapes[index]
    if (shape) {
      addFlanks(decor, shape, mouthsOf(island, canals), small)
    }
  })
  return decor
}

/** How many trees an empty lot gets on this ground, before the small city's extra one. */
function treesPerLot(nature: ParcelNature, random: () => number): number {
  switch (nature) {
    case 'unanalyzed':
      return 0
    case 'tests':
      return 2 + Math.floor(random() * 2)
    case 'normal':
      return 1 + Math.floor(random() * 3)
  }
}

const key = (x: number, y: number) => `${Math.round(x * 10)},${Math.round(y * 10)}`

/** Each grid of an island, with its empty lots, by column and row and by their centres. */
function lotGrids(island: IslandLayout) {
  const taken = new Set(island.lots.map((lot) => key(lot.x, lot.y)))
  return (island.grids ?? []).map((grid) => {
    const columns = Math.round(grid.rect.width / LOT_SIZE)
    const rows = Math.round(grid.rect.height / LOT_SIZE)
    const centre = (column: number, row: number): Point => ({
      x: grid.rect.x + LOT_SIZE * column + LOT_SIZE / 2,
      y: grid.rect.y + LOT_SIZE * row + LOT_SIZE / 2,
    })
    const isEmpty = (column: number, row: number) => {
      const { x, y } = centre(column, row)
      return !taken.has(key(x, y))
    }
    const empty = () => {
      const centres: Point[] = []
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          if (isEmpty(column, row)) {
            centres.push(centre(column, row))
          }
        }
      }
      return centres
    }
    return { grid, isEmpty, empty }
  })
}

/**
 * The empty lots of the island's folders get trees, `wooded` the share of them that do (the
 * budget's). The island folder's own grid, on the paved plateau, turns its empty lots into
 * gardens instead.
 */
function addLotTrees(
  decor: Decor,
  island: IslandLayout,
  altitude: number,
  small: boolean,
  wooded: number,
): void {
  for (const { grid, isEmpty, empty } of lotGrids(island)) {
    if (grid.square) {
      for (const rect of squareGardens(grid.rect, isEmpty)) {
        addGarden(decor, island, { rect, bottom: altitude, top: altitude + slabTop(1) }, small)
      }
      continue
    }
    for (const { x, y } of empty()) {
      const random = seededRandom(`decor/${island.path}/lot/${key(x, y)}`)
      if (random() >= wooded) {
        continue
      }
      let count = treesPerLot(grid.nature, random)
      if (count > 0 && small) {
        count = Math.min(count + 1, MAX_LOT_TREES)
      }
      scatterInLot(decor.trees, { x, y }, altitude + grid.base, count, random)
    }
  }
}

function addGarden(decor: Decor, island: IslandLayout, garden: Garden, small: boolean): void {
  decor.gardens.push(garden)
  // Gardens are tiled in lots, centred, as wooded as a park of tests: half the lots, 2 or 3 trees.
  const { rect } = garden
  const columns = Math.max(1, Math.round(rect.width / LOT_SIZE))
  const rows = Math.max(1, Math.round(rect.height / LOT_SIZE))
  const x0 = rect.x + (rect.width - columns * LOT_SIZE) / 2
  const y0 = rect.y + (rect.height - rows * LOT_SIZE) / 2
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = x0 + LOT_SIZE * column + LOT_SIZE / 2
      const y = y0 + LOT_SIZE * row + LOT_SIZE / 2
      const random = seededRandom(`decor/${island.path}/garden/${key(x, y)}`)
      if (!small && random() >= 0.5) {
        continue
      }
      scatterInLot(decor.trees, { x, y }, garden.top, treesPerLot('tests', random), random)
    }
  }
}

function scatterInLot(
  trees: Tree[],
  centre: Point,
  z: number,
  count: number,
  random: () => number,
): void {
  const placed: { x: number; y: number; r: number }[] = []
  for (let tree = 0; tree < count; tree++) {
    const kind: TreeKind = random() < LOT_CONIFERS ? 'conifer' : 'round'
    const size = SIZES[0] + (SIZES[1] - SIZES[0]) * random()
    const r = CROWN_RADIUS[kind] * size
    const reach = Math.min(LOT_SCATTER, LOT_ROOM - r)
    for (let attempt = 0; attempt < PLACEMENT_TRIES; attempt++) {
      const x = centre.x + reach * (2 * random() - 1)
      const y = centre.y + reach * (2 * random() - 1)
      const clear = placed.every(
        (other) => Math.hypot(other.x - x, other.y - y) >= CROWN_OVERLAP * (other.r + r),
      )
      if (clear) {
        placed.push({ x, y, r })
        trees.push(treeAt(x, y, z, kind, size, random))
        break
      }
    }
  }
}

function treeAt(
  x: number,
  y: number,
  z: number,
  kind: TreeKind,
  size: number,
  random: () => number,
): Tree {
  return {
    x,
    y,
    z,
    kind,
    size,
    angle: random() * Math.PI * 2,
    foliage: Math.floor(random() * FOLIAGE_TINTS.length),
    seed: random(),
  }
}

/** Where each canal pours over the plateau's edge, on the plateau rectangle. */
function mouthsOf(island: IslandLayout, cells: readonly CanalCell[]): Point[] {
  const { x, y, width, height } = island.plateau
  return cells.flatMap(({ rect, mouth }): Point[] => {
    const cx = rect.x + rect.width / 2
    const cy = rect.y + rect.height / 2
    switch (mouth) {
      case 'south':
        return [{ x: cx, y }]
      case 'north':
        return [{ x: cx, y: y + height }]
      case 'west':
        return [{ x, y: cy }]
      case 'east':
        return [{ x: x + width, y: cy }]
      default:
        return []
    }
  })
}

/** Trees on the terraces' grass, rocks along the shore. */
function addFlanks(decor: Decor, shape: IslandShape, mouths: readonly Point[], small: boolean) {
  const { samples, altitudes, island } = shape
  const terraces = altitudes.length - 1
  const random = seededRandom(`decor/${island.path}/flanks`)
  const boost = small ? 2 : 1
  for (const sample of samples) {
    const nearCascade = mouths.some(
      (mouth) => Math.hypot(mouth.x - sample.x, mouth.y - sample.y) < CASCADE_CLEARANCE,
    )
    // The tangent, to slide along the contour (counter-clockwise outlines: normal turned left)
    const tx = -sample.ny
    const ty = sample.nx
    // Grass terraces only: the last ring is the beach.
    for (let ring = 1; ring < terraces; ring++) {
      const inner = sample.offsets[ring - 1] ?? 0
      const outer = sample.offsets[ring] ?? inner
      const width = outer - inner
      const roll = random()
      if (nearCascade || width < MIN_FLANK_WIDTH || roll >= FLANK_SHARE * boost) {
        continue
      }
      const across =
        inner + width * (FLANK_ACROSS[0] + (FLANK_ACROSS[1] - FLANK_ACROSS[0]) * random())
      const slide = FLANK_SLIDE * (2 * random() - 1)
      const kind: TreeKind = random() < FLANK_CONIFERS ? 'conifer' : 'round'
      // Never wider than the terrace it stands on.
      const size = Math.min(
        SIZES[0] + (SIZES[1] - SIZES[0]) * random(),
        width / (2 * CROWN_RADIUS[kind]),
      )
      decor.trees.push(
        treeAt(
          sample.x + sample.nx * across + tx * slide,
          sample.y + sample.ny * across + ty * slide,
          altitudes[ring] ?? 0,
          kind,
          size,
          random,
        ),
      )
    }
    const roll = random()
    if (nearCascade || roll >= ROCK_SHARE * boost) {
      continue
    }
    const radius = ROCK_RADII[0] + (ROCK_RADII[1] - ROCK_RADII[0]) * random()
    // At the foot of the beach, half in the water.
    const out = (sample.offsets[terraces] ?? 0) + radius * 0.3
    const slide = FLANK_SLIDE * (2 * random() - 1)
    decor.rocks.push({
      x: sample.x + sample.nx * out + tx * slide,
      y: sample.y + sample.ny * out + ty * slide,
      radius,
      angle: random() * Math.PI * 2,
      seed: random(),
    })
  }
}
