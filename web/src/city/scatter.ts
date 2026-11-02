import { archetypeGeometry, stretched, type Triangle } from './archetype-geometry'
import type { Archetype, Building } from './archetypes'
import type { ParcelNature } from './layout'
import { seededRandom } from './random'

/** Low buildings scatter in their lot; the others stand in line, centred. */
const SCATTERED: ReadonlySet<Archetype> = new Set(['pavilion', 'house'])
/** A low concrete block scatters too, but not on concrete ground, which stays in line. */
const LOW_BLOCK = 1
/** Every building, overhangs included, stays within 0.9 u of its lot's centre. */
const HALF_LOT_ROOM = 0.9
const MAX_TURN = (15 * Math.PI) / 180

/** How a building stands in its lot: an offset from the centre, in u, and a turn about z. */
export interface Placement {
  dx: number
  dy: number
  angle: number
}

const ALIGNED: Placement = { dx: 0, dy: 0, angle: 0 }

/** Building an archetype's triangles takes a while: once per archetype. */
const triangles = new Map<Archetype, Triangle[]>()
function trianglesOf(archetype: Archetype): Triangle[] {
  const known = triangles.get(archetype)
  if (known) {
    return known
  }
  const built = archetypeGeometry(archetype)
  triangles.set(archetype, built)
  return built
}

/** The farthest any vertex reaches from the centre, on x or y, once turned as `makeRotationY` does. */
function reach(archetype: Archetype, building: Building, angle: number): number {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  let farthest = 0
  for (const triangle of trianglesOf(archetype)) {
    for (const vertex of triangle) {
      // three.js x and z are the board's x and −y
      const [x, , z] = stretched(vertex, building)
      farthest = Math.max(farthest, Math.abs(x * cos + z * sin), Math.abs(z * cos - x * sin))
    }
  }
  return farthest
}

/**
 * Where a low building stands in the lot centred on (x, y): turned a little and moved off the
 * centre, never beyond the room its lot leaves, so neighbours stay 0.2 u apart. A concrete block
 * of one or two floors scatters too, unless its parcel is concrete ground. The same lot always
 * gives the same placement.
 */
export function placementFor(
  building: Building,
  x: number,
  y: number,
  ground: ParcelNature = 'normal',
): Placement {
  const lowBlock =
    building.archetype === 'concreteBlock' &&
    building.height <= LOW_BLOCK &&
    ground !== 'unanalyzed'
  if (!SCATTERED.has(building.archetype) && !lowBlock) {
    return ALIGNED
  }
  const random = seededRandom(`${x.toFixed(2)},${y.toFixed(2)}`)
  let angle = (random() * 2 - 1) * MAX_TURN
  let room = HALF_LOT_ROOM - reach(building.archetype, building, angle)
  if (room < 0) {
    angle = 0
    room = Math.max(HALF_LOT_ROOM - reach(building.archetype, building, 0), 0)
  }
  return { dx: (random() * 2 - 1) * room, dy: (random() * 2 - 1) * room, angle }
}

/** For the tests: the farthest a placed building reaches from its lot's centre, on x or y. */
export function placedReach(building: Building, placement: Placement): number {
  return (
    reach(building.archetype, building, placement.angle) +
    Math.max(Math.abs(placement.dx), Math.abs(placement.dy))
  )
}
