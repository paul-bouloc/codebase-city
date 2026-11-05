import type { Language } from '../ui/Badge'

/** An axis-aligned rectangle on the ground, in board coordinates (x, y), in u. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

/** The languages the city paints in their own colour; the others share one. */
export type BuildingLanguage = Language | 'python' | 'go'

/** What a file the analyzer does not read holds: each family has its shade of concrete. */
export type ConcreteFamily = 'docs' | 'markup' | 'data' | 'styles' | 'scripts'

/** What a building is made from. */
export interface FileMetrics {
  /** Path from the repository root: it seeds the building's variant. Empty if absent. */
  path?: string
  language: BuildingLanguage
  lines: number
  complexity: number
  test: boolean
  /** False for a language the analyzer does not read: a bare concrete block. True if absent. */
  analyzed?: boolean
  /** The shade of a concrete block; `docs` if absent. */
  family?: ConcreteFamily
  /** Made by a tool: pale concrete walls and three bars on the roof. False if absent. */
  generated?: boolean
}

/** A file's 2 × 2 u lot, by its centre. */
export interface Lot extends Point {
  file: FileMetrics
  /** Height of the ground under the lot above the plateau, in u: the parcels it stands on. */
  base?: number
  /** The nature of the parcel the lot stands on; `normal` if absent, or on the plateau. */
  ground?: ParcelNature
  /** The lots of its folder's grid, without their margin; none in a city made up for development. */
  grid?: Rect
}

/** What most files of a parcel are: a park for tests, concrete for unread languages. */
export type ParcelNature = 'normal' | 'tests' | 'unanalyzed'

/** A folder inside an island: a slab that holds its subfolders' parcels and its own lots. */
export interface ParcelLayout {
  rect: Rect
  /** 1 for a folder of the island, 2 for one of its subfolders, and so on. */
  level: number
  nature: ParcelNature
  /**
   * A folder with subfolders is paved: the gaps between their parcels are its streets. Its own
   * files then stand on a slab of their own, one level up. False if absent.
   */
  paved?: boolean
}

/** A folder's grid of 2 × 2 u lots, some holding its files, the others left empty. */
export interface GridLayout {
  /** The lots alone, without the parcel's margin around them. */
  rect: Rect
  /** The nature of the ground the grid stands on. */
  nature: ParcelNature
  /** Height of that ground above the plateau, in u, as its lots' `base`. */
  base: number
  /** The island folder's own grid, in its square on the paved plateau. False if absent. */
  square?: boolean
}

export interface IslandLayout {
  path: string
  /** 1 (foundations, lowest) to 5 (highest). */
  layer: number
  plateau: Rect
  /** Outer parcels first, so that each parcel comes after the one it stands on. */
  parcels: ParcelLayout[]
  lots: Lot[]
  /** Where the island folder's own files stand on the plateau, their lots and margin. */
  square?: Rect
  /** Every grid of the island; none if absent (a city made up for development). */
  grids?: GridLayout[]
}

/** Imports from the files of one island to those of another, by the islands' indices. */
export interface IslandLink {
  from: number
  to: number
  imports: number
  /** How many of them go up the layers. */
  upward: number
}

export interface CityLayout {
  islands: IslandLayout[]
  /** The union of the plateaux. */
  bounds: Rect
  /** Imports between islands; none if absent. */
  links?: IslandLink[]
}

export function boundsOf(rects: readonly Rect[]): Rect {
  if (rects.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const rect of rects) {
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** Distance from a point to a rectangle, 0 inside. */
export function distanceToRect(px: number, py: number, rect: Rect): number {
  const dx = Math.max(rect.x - px, 0, px - (rect.x + rect.width))
  const dy = Math.max(rect.y - py, 0, py - (rect.y + rect.height))
  return Math.hypot(dx, dy)
}
