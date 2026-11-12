import type { CityTarget } from '../interaction/picking'
import type { CityLayout, Rect } from '../world/layout'
import { boardToThree, layerAltitude, slabTop, type Vec3 } from '../world/units'

// Which islands and folders get a label, where it stands, and which labels the screen has room
// for: the larger first, none over another.

/** How far out of its plateau an island's label stands, in u. */
const ISLAND_LABEL_OFFSET = 1.5
/** How high over its slab a folder's label stands, in u. */
const PARCEL_LABEL_LIFT = 0.3
/** An island's label shows once its plateau spans this many CSS pixels, */
export const ISLAND_LABEL_PIXELS = 60
/** a folder's once its parcel spans this many. */
export const PARCEL_LABEL_PIXELS = 80
/** No more labels than these on screen: of islands, of folders, and of both. */
export const MAX_ISLAND_LABELS = 24
export const MAX_PARCEL_LABELS = 30
export const MAX_LABELS = 40
/** The screen is cut into square cells this many CSS pixels wide; a label takes those it covers. */
export const LABEL_CELL = 24

/** An island or a folder that may carry a label. */
export interface LabelArea {
  target: Extract<CityTarget, { kind: 'island' | 'parcel' }>
  path: string
  /** Where its label stands, in three.js coordinates. */
  anchor: Vec3
  /** The middle of its ground: its span on screen is measured there, and its label leans away. */
  centre: Vec3
  /** Its longer side, in u. */
  extent: number
}

/**
 * The islands and folders of the city that may carry a label: every island; every folder but
 * a park of tests, whose colour says enough. An island's label stands at the water, out from the
 * middle of a side of its plateau: the first that faces the open sea, west, east, south then
 * north; failing that, the one with the most water before the next island.
 */
export function labelAreas(layout: CityLayout): LabelArea[] {
  const plateaux = layout.islands.map((island) => island.plateau)
  const areas: LabelArea[] = []
  layout.islands.forEach((island, at) => {
    const { plateau } = island
    const middle = { x: plateau.x + plateau.width / 2, y: plateau.y + plateau.height / 2 }
    const side = seaward(plateau, plateaux)
    const anchor =
      side === 'west'
        ? { x: plateau.x - ISLAND_LABEL_OFFSET, y: middle.y }
        : side === 'east'
          ? { x: plateau.x + plateau.width + ISLAND_LABEL_OFFSET, y: middle.y }
          : side === 'south'
            ? { x: middle.x, y: plateau.y - ISLAND_LABEL_OFFSET }
            : { x: middle.x, y: plateau.y + plateau.height + ISLAND_LABEL_OFFSET }
    const altitude = layerAltitude(island.layer)
    areas.push({
      target: { kind: 'island', island: at },
      path: island.path,
      anchor: boardToThree(anchor.x, anchor.y, 0),
      centre: boardToThree(middle.x, middle.y, altitude),
      extent: Math.max(plateau.width, plateau.height),
    })
    island.parcels.forEach((parcel, index) => {
      if (parcel.path === undefined || parcel.nature === 'tests') {
        return
      }
      const { rect } = parcel
      const centre = boardToThree(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
        altitude + slabTop(parcel.level) + PARCEL_LABEL_LIFT,
      )
      areas.push({
        target: { kind: 'parcel', island: at, parcel: index },
        path: parcel.path,
        anchor: centre,
        centre,
        extent: Math.max(rect.width, rect.height),
      })
    })
  })
  return areas
}

/** A label that could show, where its box would stand on the canvas, in CSS pixels. */
export interface LabelCandidate {
  island: boolean
  /** The area's span on screen, in CSS pixels: the larger first. */
  span: number
  /** The selected folder's label comes before all others. */
  selected: boolean
  x: number
  y: number
  width: number
  height: number
}

/**
 * Which of these labels show: the selected one first, then islands before folders, the larger
 * first; a label shows if no cell it covers is taken, and within the caps.
 */
export function placeLabels(candidates: readonly LabelCandidate[]): boolean[] {
  const order = candidates.map((_, at) => at).sort((a, b) => rank(candidates[a], candidates[b]))
  const shown = candidates.map(() => false)
  const taken = new Set<string>()
  let islands = 0
  let parcels = 0
  for (const at of order) {
    const label = candidates[at]
    if (!label || islands + parcels === MAX_LABELS) {
      break
    }
    if (label.island ? islands === MAX_ISLAND_LABELS : parcels === MAX_PARCEL_LABELS) {
      continue
    }
    const cells = cellsOf(label)
    if (cells.some((cell) => taken.has(cell))) {
      continue
    }
    for (const cell of cells) {
      taken.add(cell)
    }
    shown[at] = true
    if (label.island) {
      islands += 1
    } else {
      parcels += 1
    }
  }
  return shown
}

function rank(a: LabelCandidate | undefined, b: LabelCandidate | undefined): number {
  if (!a || !b) {
    return 0
  }
  if (a.selected !== b.selected) {
    return a.selected ? -1 : 1
  }
  if (a.island !== b.island) {
    return a.island ? -1 : 1
  }
  return b.span - a.span
}

/** The cells a label's box covers. */
function cellsOf({ x, y, width, height }: LabelCandidate): string[] {
  const cells: string[] = []
  const left = Math.floor(x / LABEL_CELL)
  const right = Math.floor((x + width) / LABEL_CELL)
  const top = Math.floor(y / LABEL_CELL)
  const bottom = Math.floor((y + height) / LABEL_CELL)
  for (let column = left; column <= right; column += 1) {
    for (let row = top; row <= bottom; row += 1) {
      cells.push(`${column},${row}`)
    }
  }
  return cells
}

type Side = 'west' | 'east' | 'south' | 'north'

/** The side of a plateau its label stands on: open sea first, in this order, else the most water. */
const SIDES: readonly Side[] = ['west', 'east', 'south', 'north']

function seaward(plateau: Rect, plateaux: readonly Rect[]): Side {
  let best: Side = 'west'
  let widest = Number.NEGATIVE_INFINITY
  for (const side of SIDES) {
    const water = waterBefore(plateau, side, plateaux)
    if (water === Number.POSITIVE_INFINITY) {
      return side
    }
    if (water > widest) {
      widest = water
      best = side
    }
  }
  return best
}

/** How much water lies off a side of a plateau before another one, in u; endless for the sea. */
function waterBefore(plateau: Rect, side: Side, plateaux: readonly Rect[]): number {
  const across = side === 'west' || side === 'east'
  let water = Number.POSITIVE_INFINITY
  for (const other of plateaux) {
    if (other === plateau) {
      continue
    }
    const facing = across
      ? other.y < plateau.y + plateau.height && other.y + other.height > plateau.y
      : other.x < plateau.x + plateau.width && other.x + other.width > plateau.x
    if (!facing) {
      continue
    }
    const gap =
      side === 'west'
        ? plateau.x - (other.x + other.width)
        : side === 'east'
          ? other.x - (plateau.x + plateau.width)
          : side === 'south'
            ? plateau.y - (other.y + other.height)
            : other.y - (plateau.y + plateau.height)
    if (gap >= 0) {
      water = Math.min(water, gap)
    }
  }
  return water
}
