import { pickVariant } from './variants'
import { PAVILION_HEIGHTS } from './variants-kit'
import type { FileMetrics } from './world/layout'
import { FLOOR_HEIGHT } from './world/units'

export const ARCHETYPES = [
  'pavilion',
  'hall',
  'house',
  'smallBlock',
  'setbackBlock',
  'pyramidRoof',
  'towerOnPodium',
  'concreteBlock',
] as const

export type Archetype = (typeof ARCHETYPES)[number]

const MAX_FLOORS = 40
const MAX_LINES = 3000
export const MIN_SIDE = 0.75
const SIDE_RANGE = 0.95
export const MAX_SIDE = MIN_SIDE + SIDE_RANGE
/** From this side, a low building is a Hall rather than a House. */
export const HALL_MIN_SIDE = 1.5
/** The Pavilion's roof overhangs by 0.13 u on each side: this keeps it inside 1.8 u. */
export const PAVILION_MAX_SIDE = 1.54
/** A House's walls stop a little short of their floors, under the roof. */
const HOUSE_WALL_RATIO = 0.9
const SETBACK_BASE_RATIO = 0.62
/** A file the analyzer does not read rises one floor per 150 lines, up to 4. */
const UNANALYZED_LINES_PER_FLOOR = 150
const UNANALYZED_MAX_FLOORS = 4

export function floorsFor(complexity: number): number {
  const floors = Math.round(1.2 * Math.max(complexity, 0) ** 0.55)
  return Math.min(Math.max(floors, 1), MAX_FLOORS)
}

/** Side of the footprint, in u: 0.75 to 1.70. */
export function footprintFor(lines: number): number {
  const share = Math.min(Math.max(lines, 0), MAX_LINES) / MAX_LINES
  return MIN_SIDE + SIDE_RANGE * Math.sqrt(share)
}

/** The first archetype that fits, in this order. */
export function archetypeFor(floors: number, side: number, test: boolean): Archetype {
  // A simple test is a Pavilion; a complex one rises like any file, in the tests' colour
  if (floors <= 2) {
    if (test) {
      return 'pavilion'
    }
    return side >= HALL_MIN_SIDE ? 'hall' : 'house'
  }
  if (floors <= 5) {
    return 'smallBlock'
  }
  if (floors <= 10) {
    return 'setbackBlock'
  }
  if (floors <= 16) {
    return 'pyramidRoof'
  }
  return 'towerOnPodium'
}

/** What one instance needs; each archetype reads `height` and `split` its own way. */
export interface Building {
  archetype: Archetype
  /** Side of the footprint, in u. */
  side: number
  /** Top of the body, in u: the walls under a roof, or the whole body. */
  height: number
  /** Top of the Setback block's base, in u; 0 for the others. */
  split: number
  /** The pieces a house, a pavilion or a concrete block is made of; none for the others. */
  pieces: readonly string[]
}

export function buildingFor({
  path = '',
  lines,
  complexity,
  test,
  analyzed = true,
}: FileMetrics): Building {
  const side = footprintFor(lines)
  if (!analyzed) {
    const floors = Math.min(
      Math.max(Math.ceil(lines / UNANALYZED_LINES_PER_FLOOR), 1),
      UNANALYZED_MAX_FLOORS,
    )
    return {
      archetype: 'concreteBlock',
      side,
      height: floors * FLOOR_HEIGHT,
      split: 0,
      pieces: pickVariant('concreteBlock', path, { side, floors }),
    }
  }
  const floors = floorsFor(complexity)
  const archetype = archetypeFor(floors, side, test)
  switch (archetype) {
    case 'pavilion': {
      const pavilionSide = Math.min(side, PAVILION_MAX_SIDE)
      return {
        archetype,
        side: pavilionSide,
        // The height under the roof
        height: PAVILION_HEIGHTS[floors >= 2 ? 1 : 0],
        split: 0,
        pieces: pickVariant(archetype, path, { side: pavilionSide, floors }),
      }
    }
    case 'house':
      return {
        archetype,
        side,
        height: floors * FLOOR_HEIGHT * HOUSE_WALL_RATIO,
        split: 0,
        pieces: pickVariant(archetype, path, { side, floors }),
      }
    case 'setbackBlock':
      return {
        archetype,
        side,
        height: floors * FLOOR_HEIGHT,
        split: Math.round(floors * SETBACK_BASE_RATIO) * FLOOR_HEIGHT,
        pieces: [],
      }
    default:
      return { archetype, side, height: floors * FLOOR_HEIGHT, split: 0, pieces: [] }
  }
}
