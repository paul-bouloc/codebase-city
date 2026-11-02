import { type CityLayout, distanceToRect, type IslandLayout, type Rect } from './layout'
import { seededRandom } from './random'
import { layerAltitude } from './units'

// An island's terrain is a stack of rings around its plateau: the plateau's own edge, then one
// ring per terrace, the last one the beach. Every ring is the plateau rectangle pushed outward
// by an offset that varies along the edge: rounded corners, a seeded wobble, and terraces wide
// on the open sea and narrow where another island is close.

/** Distance between two samples along a side of the plateau, in u. */
export const SAMPLE_STEP = 2.2
/** Samples inside each rounded corner, between the two sides' own. */
export const CORNER_SAMPLES = 6
/** The beach is the last terrace, just above the sea. */
export const BEACH_ALTITUDE = 0.35
/** The foam around a beach. */
export const FOAM_WIDTH = 0.9
/** Water left between the foams of two neighbours. */
const FREE_WATER = 0.3

/** The plateau's edge stands 0.85 u past the rectangle, plus up to 0.35 u of wobble. */
const EDGE_OFFSET = 0.85
const EDGE_WOBBLE = 0.35
/** How far each terrace pushes out, facing the open sea or another island. */
const OPEN_SEA_FACTOR = 1.3
const FACING_FACTOR = 0.45
/** Distances to the island ahead between which the terraces widen. */
const FACING_NEAR = 24
const FACING_FAR = 36
/** Each rounded corner counts as this much length when the wobble runs along the edge. */
const CORNER_LENGTH = Math.PI / 2

export type Side = 'south' | 'east' | 'north' | 'west'

/** A point on the plateau rectangle's edge, with its outward normal and the rings' offsets. */
export interface ContourSample {
  x: number
  y: number
  nx: number
  ny: number
  /** How far each ring stands past this point, along the normal: the plateau's edge first. */
  offsets: number[]
}

export interface IslandShape {
  island: IslandLayout
  /** The top of each ring: the plateau, then each terrace down to the beach. */
  altitudes: number[]
  /** Around the plateau, counter-clockwise from its south-west corner. */
  samples: ContourSample[]
  /** How far the beach reaches past the plateau rectangle, at most. */
  reach: number
  /** The rings' offsets at a point of a side, `along` it from its counter-clockwise start. */
  offsetsAt(side: Side, along: number): number[]
}

/** The terrain of every island, knowing its neighbours. */
export function islandShapes(layout: CityLayout): IslandShape[] {
  const plateaux = layout.islands.map((island) => island.plateau)
  return layout.islands.map((island, index) =>
    islandShape(
      island,
      plateaux.filter((_, other) => other !== index),
    ),
  )
}

/** The altitudes of an island's rings, from its plateau down to its beach. */
export function ringAltitudes(layer: number): number[] {
  const plateau = layerAltitude(layer)
  const terraces = Math.max(1, Math.round(plateau / 1.3))
  return [
    plateau,
    ...Array.from(
      { length: terraces },
      (_, j) => plateau - ((plateau - BEACH_ALTITUDE) * (j + 1)) / terraces,
    ),
  ]
}

export function islandShape(island: IslandLayout, others: readonly Rect[]): IslandShape {
  const altitudes = ringAltitudes(island.layer)
  const terraces = altitudes.length - 1
  const wobble = edgeWobble(island.path)
  const { x: x0, y: y0, width, height } = island.plateau
  const x1 = x0 + width
  const y1 = y0 + height
  const perimeter = 2 * width + 2 * height + 4 * CORNER_LENGTH

  // Where each side starts along the perimeter, and the point it starts from.
  const sides: Record<Side, { start: number; from: [number, number]; normal: [number, number] }> = {
    south: { start: 0, from: [x0, y0], normal: [0, -1] },
    east: { start: width + CORNER_LENGTH, from: [x1, y0], normal: [1, 0] },
    north: { start: width + height + 2 * CORNER_LENGTH, from: [x1, y1], normal: [0, 1] },
    west: { start: 2 * width + height + 3 * CORNER_LENGTH, from: [x0, y1], normal: [-1, 0] },
  }
  const directions: Record<Side, [number, number]> = {
    south: [1, 0],
    east: [0, 1],
    north: [-1, 0],
    west: [0, -1],
  }

  const offsets = (position: number, x: number, y: number, nx: number, ny: number): number[] => {
    let nearest = Number.POSITIVE_INFINITY
    let ahead = Number.POSITIVE_INFINITY
    for (const other of others) {
      nearest = Math.min(nearest, distanceToRect(x, y, other))
      ahead = Math.min(ahead, distanceAhead(x, y, nx, ny, other))
    }
    return ringOffsets(wobble(position / perimeter), ahead, nearest, terraces)
  }

  const samples: ContourSample[] = []
  const order: Side[] = ['south', 'east', 'north', 'west']
  for (const side of order) {
    const { start, from, normal } = sides[side]
    const [dx, dy] = directions[side]
    const length = side === 'south' || side === 'north' ? width : height
    const steps = Math.max(1, Math.round(length / SAMPLE_STEP))
    for (let i = 0; i <= steps; i++) {
      const along = (length * i) / steps
      const x = from[0] + dx * along
      const y = from[1] + dy * along
      samples.push({
        x,
        y,
        nx: normal[0],
        ny: normal[1],
        offsets: offsets(start + along, x, y, normal[0], normal[1]),
      })
    }
    // The corner after this side turns the normal toward the next side's.
    const cornerX = from[0] + dx * length
    const cornerY = from[1] + dy * length
    const base = Math.atan2(normal[1], normal[0])
    for (let m = 1; m <= CORNER_SAMPLES; m++) {
      const turn = m / (CORNER_SAMPLES + 1)
      const angle = base + (Math.PI / 2) * turn
      const nx = Math.cos(angle)
      const ny = Math.sin(angle)
      samples.push({
        x: cornerX,
        y: cornerY,
        nx,
        ny,
        offsets: offsets(start + length + CORNER_LENGTH * turn, cornerX, cornerY, nx, ny),
      })
    }
  }

  const reach = Math.max(0, ...samples.map((sample) => sample.offsets[terraces] ?? 0))
  return {
    island,
    altitudes,
    samples,
    reach,
    offsetsAt(side, along) {
      const { start, from, normal } = sides[side]
      const [dx, dy] = directions[side]
      const x = from[0] + dx * along
      const y = from[1] + dy * along
      return offsets(start + along, x, y, normal[0], normal[1])
    },
  }
}

/**
 * The offsets of the plateau's edge and of each terrace, at a point of the edge where the wobble
 * is `wobble` (0 to 1), the island it faces `ahead` u away, and the nearest one `nearest` u.
 */
export function ringOffsets(
  wobble: number,
  ahead: number,
  nearest: number,
  terraces: number,
): number[] {
  const factor = FACING_FACTOR + (OPEN_SEA_FACTOR - FACING_FACTOR) * smoothstep(ahead)
  const edge = EDGE_OFFSET + EDGE_WOBBLE * wobble
  // One wobble for every ring, growing outward: rings never cross.
  const rings = Array.from(
    { length: terraces },
    (_, index) => EDGE_OFFSET + (index + 1) * factor + (0.4 + 0.4 * (index + 1)) * factor * wobble,
  )
  // Two neighbours share the water between them: each beach keeps to its half, foam included.
  const limit = nearest / 2 - FOAM_WIDTH - FREE_WATER
  const beach = rings.at(-1) ?? edge
  if (beach > limit && beach > edge) {
    const scale = Math.max(0, limit - edge) / (beach - edge)
    return [edge, ...rings.map((ring) => edge + (ring - edge) * scale)]
  }
  return [edge, ...rings]
}

/**
 * How far a rectangle stands in front of a point, along its normal; a rectangle off to the side
 * counts twice its sideways distance more, so that the terraces narrow gradually as a
 * neighbour comes into view. Infinite for a rectangle behind.
 */
function distanceAhead(x: number, y: number, nx: number, ny: number, rect: Rect): number {
  let nearestAlong = Number.POSITIVE_INFINITY
  let farthestAlong = Number.NEGATIVE_INFINITY
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  for (const [cx, cy] of [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x, rect.y + rect.height],
    [rect.x + rect.width, rect.y + rect.height],
  ] as const) {
    const along = (cx - x) * nx + (cy - y) * ny
    const across = (cx - x) * -ny + (cy - y) * nx
    nearestAlong = Math.min(nearestAlong, along)
    farthestAlong = Math.max(farthestAlong, along)
    left = Math.min(left, across)
    right = Math.max(right, across)
  }
  if (farthestAlong <= 0) {
    return Number.POSITIVE_INFINITY
  }
  const sideways = Math.max(left, 0, -right)
  return Math.max(nearestAlong, 0) + 2 * sideways
}

function smoothstep(distance: number): number {
  const t = Math.min(Math.max((distance - FACING_NEAR) / (FACING_FAR - FACING_NEAR), 0), 1)
  return t * t * (3 - 2 * t)
}

/** The design's edge noise, in [0, 1], over a position `t` from 0 to 1 around the island. */
function edgeWobble(path: string): (t: number) => number {
  const random = seededRandom(`island/${path}`)
  const phases = [random(), random(), random()].map((value) => value * Math.PI * 2)
  return (t) =>
    0.5 +
    0.25 * Math.sin(2 * Math.PI * 3 * t + (phases[0] ?? 0)) +
    0.15 * Math.sin(2 * Math.PI * 7 * t + (phases[1] ?? 0)) +
    0.1 * Math.sin(2 * Math.PI * 13 * t + (phases[2] ?? 0))
}
