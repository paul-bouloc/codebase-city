import type { CityTarget } from '../interaction/picking'
import type { CityLayout } from '../world/layout'
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

/** Which way a label runs from its anchor on screen: out to the sea, or both ways for a folder. */
export type LabelLean = 'start' | 'end' | 'centre'

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
 * a park of tests, whose colour says enough. An island's label stands on the open sea, west of
 * it, or east for an island on the city's east edge, at the water.
 */
export function labelAreas(layout: CityLayout): LabelArea[] {
  const { bounds } = layout
  const east = bounds.x + bounds.width
  const areas: LabelArea[] = []
  layout.islands.forEach((island, at) => {
    const { plateau } = island
    const middle = plateau.y + plateau.height / 2
    const onEastEdge = plateau.x + plateau.width >= east - 1e-6 && plateau.x > bounds.x + 1e-6
    const x = onEastEdge
      ? plateau.x + plateau.width + ISLAND_LABEL_OFFSET
      : plateau.x - ISLAND_LABEL_OFFSET
    const altitude = layerAltitude(island.layer)
    areas.push({
      target: { kind: 'island', island: at },
      path: island.path,
      anchor: boardToThree(x, middle, 0),
      centre: boardToThree(plateau.x + plateau.width / 2, middle, altitude),
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
  const order = candidates
    .map((_, at) => at)
    .sort((a, b) => rank(candidates[a], candidates[b]))
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
