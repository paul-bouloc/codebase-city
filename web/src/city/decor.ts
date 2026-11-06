import { type CanalCell, islandCanals } from './canals'
import { islandGardens, squareGardens } from './gardens'
import { type ContourSample, type IslandShape, SAMPLE_STEP } from './island-shape'
import type { CityLayout, GridLayout, IslandLayout, ParcelNature, Point, Rect } from './layout'
import type { Boat, Quay } from './links'
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
  /** Scale of the model, 0.7 to 1.2. */
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
/** Conifers in lots and gardens, and on the flanks. */
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
/** No rock under a quay, nor this close to a moored or sailing boat's centre. */
const QUAY_CLEARANCE = 0.2
const BOAT_CLEARANCE = 1.2

/**
 * At most this many trees on a city's empty lots and gardens. The layout's stretch leaves many
 * more empty lots than the 13 % it draws (vscode: 56 %, 52,000 trees and 1.5 M triangles); past
 * the budget, only a share of them is wooded, the others stay meadow, clearings.
 */
const TREE_BUDGET = 16_000
/**
 * However the layout came, never more trees and rocks than this: a long, thin island has a
 * shore without end. Past it, every other one, evenly, is kept.
 */
const MAX_TREES = 40_000
const MAX_ROCKS = 10_000

/**
 * A small city has twice the decor: trees on every empty lot and garden lot, one more in each
 * (3 at most), and twice the trees and rocks along its shores.
 */
const SMALL_CITY = 50
const MAX_LOT_TREES = 3
/** Gardens are wooded as a park of tests: half their lots. */
const GARDEN_SHARE = 0.5

/** Trees an empty lot gets on average: 1 to 3 on a meadow, 2 or 3 in a park of tests. */
function meanTrees(nature: ParcelNature, small: boolean): number {
  const counts = { normal: [1, 2, 3], tests: [2, 3], unanalyzed: [0] }[nature]
  const each = counts.map((count) =>
    small && count > 0 ? Math.min(count + 1, MAX_LOT_TREES) : count,
  )
  return each.reduce((sum, count) => sum + count, 0) / each.length
}

/** The quays and boats the decor keeps clear of. */
export interface Harbours {
  quays: readonly Quay[]
  boats: readonly Boat[]
}

/** The decor of a city, from its layout and its islands' terrain (in the same order). */
export function cityDecor(
  layout: CityLayout,
  shapes: readonly IslandShape[],
  harbours: Harbours = { quays: [], boats: [] },
): Decor {
  const files = layout.islands.reduce((sum, island) => sum + island.lots.length, 0)
  const small = files < SMALL_CITY
  // First what each island has room for, then as many trees as the budget allows.
  const plans = layout.islands.map((island, index) => {
    const canals = (shapes[index]?.canals ?? islandCanals(island)).cells
    const altitude = layerAltitude(island.layer)
    const grids = lotGrids(island)
    const gardens: Garden[] = [
      ...grids.flatMap(({ grid, isEmpty }) =>
        grid.square ? squareGardens(grid.rect, isEmpty) : [],
      ),
      ...islandGardens(island, canals),
    ].map((rect) => ({ rect, bottom: altitude, top: altitude + slabTop(1) }))
    const lots = grids
      .filter(({ grid }) => !grid.square)
      .map(({ grid, empty }) => ({ grid, empty: empty() }))
    return { island, canals, altitude, gardens, lots }
  })
  const gardenShare = small ? 1 : GARDEN_SHARE
  let expected = 0
  for (const { gardens, lots } of plans) {
    for (const { grid, empty } of lots) {
      expected += empty.length * meanTrees(grid.nature, small)
    }
    for (const { rect } of gardens) {
      const [columns, rows] = gardenLots(rect)
      expected += columns * rows * gardenShare * meanTrees('tests', small)
    }
  }
  const wooded = Math.min(1, TREE_BUDGET / Math.max(expected, 1))

  const decor: Decor = { trees: [], rocks: [], gardens: [] }
  plans.forEach(({ island, canals, altitude, gardens, lots }, index) => {
    for (const { grid, empty } of lots) {
      addLotTrees(decor, island, grid, altitude, empty, small, wooded)
    }
    for (const garden of gardens) {
      addGarden(decor, island, garden, small, gardenShare * wooded)
    }
    const shape = shapes[index]
    if (shape) {
      addFlanks(decor, shape, mouthsOf(island, canals), small)
    }
  })
  decor.trees = keepEvenly(decor.trees, MAX_TREES)
  decor.rocks = keepEvenly(
    decor.rocks.filter((rock) => clearOfHarbours(rock, harbours)),
    MAX_ROCKS,
  )
  return decor
}

/** Whether a rock stands off every quay and boat. */
function clearOfHarbours(rock: Rock, { quays, boats }: Harbours): boolean {
  for (const quay of quays) {
    // Along the quay from its root, and across it from its axis.
    const dx = rock.x - quay.x
    const dy = rock.y - quay.y
    const along = dx * quay.nx + dy * quay.ny
    const across = Math.abs(dx * -quay.ny + dy * quay.nx)
    const beyond = Math.max(0, -along, along - quay.length)
    if (Math.hypot(beyond, Math.max(0, across - quay.width / 2)) < rock.radius + QUAY_CLEARANCE) {
      return false
    }
  }
  return boats.every(
    (boat) => Math.hypot(rock.x - boat.x, rock.y - boat.y) >= rock.radius + BOAT_CLEARANCE,
  )
}

/** At most `max` of `items`, spread evenly through them. */
function keepEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) {
    return items
  }
  return Array.from({ length: max }, (_, n) => items[Math.floor((n * items.length) / max)] as T)
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

/** Trees on a share `wooded` of a folder's empty lots, by the nature of its ground. */
function addLotTrees(
  decor: Decor,
  island: IslandLayout,
  grid: GridLayout,
  altitude: number,
  empty: readonly Point[],
  small: boolean,
  wooded: number,
): void {
  for (const { x, y } of empty) {
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

/** A garden's lots of about 2 u, across and up. */
function gardenLots(rect: Rect): [number, number] {
  return [
    Math.max(1, Math.round(rect.width / LOT_SIZE)),
    Math.max(1, Math.round(rect.height / LOT_SIZE)),
  ]
}

/**
 * A garden, tiled in lots of about 2 u spread over its exact size so that every trunk stands
 * inside; a share `wooded` of them get 2 or 3 trees, as in a park of tests.
 */
function addGarden(
  decor: Decor,
  island: IslandLayout,
  garden: Garden,
  small: boolean,
  wooded: number,
): void {
  decor.gardens.push(garden)
  const { rect } = garden
  const [columns, rows] = gardenLots(rect)
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = rect.x + (rect.width * (column + 0.5)) / columns
      const y = rect.y + (rect.height * (row + 0.5)) / rows
      const random = seededRandom(`decor/${island.path}/garden/${key(x, y)}`)
      if (random() >= wooded) {
        continue
      }
      let count = treesPerLot('tests', random)
      if (small) {
        count = Math.min(count + 1, MAX_LOT_TREES)
      }
      scatterInLot(decor.trees, { x, y }, garden.top, count, random)
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

/**
 * How much of a ring each sample stands for, where the ring is `offset` u out along its normal:
 * half the way to each neighbour. Around a corner, eight samples share one point of the plateau
 * and fan out: drawn alike, they would crowd the corners with trees and rocks.
 */
function coverage(
  samples: readonly ContourSample[],
  offset: (sample: ContourSample) => number,
): number[] {
  const points = samples.map((sample) => {
    const o = offset(sample)
    return { x: sample.x + sample.nx * o, y: sample.y + sample.ny * o }
  })
  const count = points.length
  return points.map((point, index) => {
    const previous = points[(index - 1 + count) % count] ?? point
    const next = points[(index + 1) % count] ?? point
    const half = (a: Point) => Math.hypot(a.x - point.x, a.y - point.y) / 2
    return half(previous) + half(next)
  })
}

/** Trees on the terraces' grass, rocks along the shore, as many per length all around. */
function addFlanks(decor: Decor, shape: IslandShape, mouths: readonly Point[], small: boolean) {
  const { samples, altitudes, island } = shape
  const terraces = altitudes.length - 1
  const random = seededRandom(`decor/${island.path}/flanks`)
  const boost = small ? 2 : 1
  // The share a sample draws, from the length it stands for: about 1 along a side.
  const along = (lengths: number[]) => lengths.map((length) => length / SAMPLE_STEP)
  const terraceShares = Array.from({ length: terraces }, (_, ring) =>
    along(
      coverage(
        samples,
        (sample) => ((sample.offsets[ring - 1] ?? 0) + (sample.offsets[ring] ?? 0)) / 2,
      ),
    ),
  )
  const shoreShares = along(coverage(samples, (sample) => sample.offsets[terraces] ?? 0))
  samples.forEach((sample, index) => {
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
      const share = FLANK_SHARE * boost * (terraceShares[ring]?.[index] ?? 1)
      if (nearCascade || width < MIN_FLANK_WIDTH || roll >= share) {
        continue
      }
      const kind: TreeKind = random() < FLANK_CONIFERS ? 'conifer' : 'round'
      // Never wider than the terrace it stands on, and its crown clear of the cliff above.
      const size = Math.min(
        SIZES[0] + (SIZES[1] - SIZES[0]) * random(),
        width / (2 * CROWN_RADIUS[kind]),
      )
      const crown = CROWN_RADIUS[kind] * size
      const across =
        inner +
        crown +
        (width - 2 * crown) * (FLANK_ACROSS[0] + (FLANK_ACROSS[1] - FLANK_ACROSS[0]) * random())
      const slide = FLANK_SLIDE * (2 * random() - 1)
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
    if (nearCascade || roll >= ROCK_SHARE * boost * (shoreShares[index] ?? 1)) {
      return
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
  })
}
