import { buildingGeometry, stretched } from './archetype-geometry'
import type { Archetype, Building } from './archetypes'
import { quarterTurnsFor } from './variants'
import type { ParcelNature, Rect } from './world/layout'
import { seededRandom } from './world/random'

/** Low buildings scatter in their lot; the others stand in line, centred. */
const SCATTERED: ReadonlySet<Archetype> = new Set(['pavilion', 'house'])
/** A low concrete block scatters too, but not on concrete ground, which stays in line. */
const LOW_BLOCK = 1
/** Every building, overhangs included, stays within 0.9 u of its lot's centre. */
const HALF_LOT_ROOM = 0.9
const MAX_TURN = (15 * Math.PI) / 180
const QUARTER = Math.PI / 2

/** How a building stands in its lot: an offset from the centre, in u, and a turn about z. */
export interface Placement {
  dx: number
  dy: number
  angle: number
}

/** The farthest any vertex reaches from the centre, on x or y, once turned as `makeRotationY` does. */
function reach(building: Building, angle: number): number {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  let farthest = 0
  for (const triangle of buildingGeometry(building)) {
    for (const vertex of triangle) {
      // three.js x and z are the board's x and −y
      const [x, , z] = stretched(vertex, building)
      farthest = Math.max(farthest, Math.abs(x * cos + z * sin), Math.abs(z * cos - x * sin))
    }
  }
  return farthest
}

/**
 * The turn that points a building's front (the board's y+) along (x, y), one of the four sides.
 * `makeRotationY(angle)` takes three.js −z, the board's y+, to (−sin, −cos).
 */
function turnTowards(x: number, y: number): number {
  return Math.atan2(-x, y)
}

/**
 * The turn a building starts from, before it scatters: a house faces the nearest side of its
 * grid, its street; a pavilion or a concrete block makes the quarter turns its path draws.
 */
export function baseTurnFor(building: Building, path: string, x: number, y: number, grid?: Rect) {
  if (building.archetype === 'house') {
    if (!grid) {
      return 0
    }
    const sides: [number, number, number][] = [
      [y - grid.y, 0, -1],
      [grid.y + grid.height - y, 0, 1],
      [x - grid.x, -1, 0],
      [grid.x + grid.width - x, 1, 0],
    ]
    // Nearest first; a tie goes to the front, then the back, then the sides
    const [, dx, dy] = sides.reduce((nearest, side) =>
      side[0] < nearest[0] - 1e-9 ? side : nearest,
    )
    return turnTowards(dx, dy)
  }
  if (building.archetype === 'pavilion' || building.archetype === 'concreteBlock') {
    return quarterTurnsFor(path) * QUARTER
  }
  return 0
}

/**
 * Where a low building stands in the lot centred on (x, y): turned a little from `turn` and
 * moved off the centre, never beyond the room its lot leaves, so neighbours stay 0.2 u apart. A
 * concrete block of one or two floors scatters too, unless its parcel is concrete ground. The
 * same lot always gives the same placement.
 */
export function placementFor(
  building: Building,
  x: number,
  y: number,
  ground: ParcelNature = 'normal',
  turn = 0,
): Placement {
  const lowBlock =
    building.archetype === 'concreteBlock' &&
    building.height <= LOW_BLOCK &&
    ground !== 'unanalyzed'
  if (!SCATTERED.has(building.archetype) && !lowBlock) {
    return { dx: 0, dy: 0, angle: turn }
  }
  const random = seededRandom(`${x.toFixed(2)},${y.toFixed(2)}`)
  let angle = turn + (random() * 2 - 1) * MAX_TURN
  let room = HALF_LOT_ROOM - reach(building, angle)
  if (room < 0) {
    angle = turn
    room = Math.max(HALF_LOT_ROOM - reach(building, turn), 0)
  }
  return { dx: (random() * 2 - 1) * room, dy: (random() * 2 - 1) * room, angle }
}

/** For the tests: the farthest a placed building reaches from its lot's centre, on x or y. */
export function placedReach(building: Building, placement: Placement): number {
  return reach(building, placement.angle) + Math.max(Math.abs(placement.dx), Math.abs(placement.dy))
}
