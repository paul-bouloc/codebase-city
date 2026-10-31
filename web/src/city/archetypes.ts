import type { FileMetrics } from './layout'
import { FLOOR_HEIGHT } from './units'

export const ARCHETYPES = [
  'pavilion',
  'hall',
  'house',
  'smallBlock',
  'setbackBlock',
  'pyramidRoof',
  'towerOnPodium',
] as const

export type Archetype = (typeof ARCHETYPES)[number]

const MAX_FLOORS = 40
const MAX_LINES = 3000
const MIN_SIDE = 0.75
const SIDE_RANGE = 0.95
const HALL_MIN_SIDE = 1.5
/** The Pavilion's roof overhangs by 0.13 u on each side: this keeps it inside 1.8 u. */
const PAVILION_MAX_SIDE = 1.54
/** A House's walls stop a little short of their floors, under the roof. */
const HOUSE_WALL_RATIO = 0.9
const SETBACK_BASE_RATIO = 0.62

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
  if (test) {
    return 'pavilion'
  }
  if (floors <= 2) {
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
}

export function buildingFor({ lines, complexity, test }: FileMetrics): Building {
  const floors = floorsFor(complexity)
  const side = footprintFor(lines)
  const archetype = archetypeFor(floors, side, test)
  switch (archetype) {
    case 'pavilion':
      return { archetype, side: Math.min(side, PAVILION_MAX_SIDE), height: 0, split: 0 }
    case 'house':
      return { archetype, side, height: floors * FLOOR_HEIGHT * HOUSE_WALL_RATIO, split: 0 }
    case 'setbackBlock':
      return {
        archetype,
        side,
        height: floors * FLOOR_HEIGHT,
        split: Math.round(floors * SETBACK_BASE_RATIO) * FLOOR_HEIGHT,
      }
    default:
      return { archetype, side, height: floors * FLOOR_HEIGHT, split: 0 }
  }
}
