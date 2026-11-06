import { type Canals, islandCanals } from './canals'
import { type CityLayout, distanceToRect, type IslandLayout, type Rect } from './layout'
import { seededRandom } from './random'
import { clampLayer, layerAltitude } from './units'

// An island's terrain is a stack of rings around its plateau: the plateau's own edge, then one
// ring per terrace, the last one the beach. Every ring is the plateau rectangle pushed outward
// by an offset that varies along the edge: rounded corners, a seeded wobble, and terraces wide
// on the open sea and narrow where another island is close.

/** Distance between two samples along a side of the plateau, in u. */
export const SAMPLE_STEP = 2.2
/** Samples inside each rounded corner, between the two sides' own. */
const CORNER_SAMPLES = 6
/** The beach is the last terrace, just above the sea. */
export const BEACH_ALTITUDE = 0.35
/** The foam around a beach. */
export const FOAM_WIDTH = 0.9
/**
 * Water each of two neighbours leaves free past its foam: 15 % of the way to the other, so that
 * a channel shows open water whatever its width; never less than 0.3 u.
 */
const FREE_WATER = 0.3
const FREE_WATER_SHARE = 0.15
/** The widest beach past the plateau's rectangle, in u (see `NEIGHBOUR_REACH`). */
const WIDEST_BEACH = 24.75

/**
 * The plateau's edge stands 0.85 u past the rectangle, plus a wobble of 0.35 u where room is
 * short, up to 3.5 u on the open sea: a third of the room left before the guard.
 */
const EDGE_OFFSET = 0.85
const EDGE_WOBBLE = [0.35, 3.5] as const
const EDGE_WOBBLE_SHARE = 0.35
/**
 * Wavelengths of the wobble along the edge, in u: a large island gets as many headlands and
 * coves as its size allows, instead of three bumps however long its sides.
 */
const WOBBLE_WAVELENGTHS = [53, 29, 13] as const
/**
 * The terraces swell toward the middle of each side, nothing at the corners: 5 % of the side's
 * length, 10 u at most, so that an island reads as a cushion rather than a box.
 */
const BULGE_SHARE = 0.05
const BULGE_MAX = 10
/** How far each terrace pushes out, facing the open sea or another island. */
const OPEN_SEA_FACTOR = 1.3
const FACING_FACTOR = 0.45
/** Distances to the island ahead between which the terraces widen. */
const FACING_NEAR = 24
const FACING_FAR = 36
/** Each rounded corner counts as this much length when the wobble runs along the edge. */
const CORNER_LENGTH = Math.PI / 2
/**
 * The terraces' width is averaged over this much of the edge, each way: around a corner, from a
 * side facing an island to one facing the open sea, it changes gradually instead of in a step.
 */
const FACTOR_SMOOTHING = 8

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
  /** The canals on the plateau, computed once for the terrain and the decor. */
  canals: Canals
  /** The rings' offsets at a point of a side, `along` it from its counter-clockwise start. */
  offsetsAt(side: Side, along: number): number[]
}

/**
 * Past this distance between two plateaux, neither shapes the other: the widest beach reaches
 * 24.75 u (the edge's 4.35 u, five terraces of 2.08 u, a 10 u swell), and fits in its half with
 * its foam and free water from there on; the terraces are at their widest from 36 u on.
 */
const NEIGHBOUR_REACH = (WIDEST_BEACH + FOAM_WIDTH) / (0.5 - FREE_WATER_SHARE)

/** The terrain of every island, knowing its neighbours. */
export function islandShapes(layout: CityLayout): IslandShape[] {
  const plateaux = layout.islands.map((island) => island.plateau)
  return layout.islands.map((island, index) =>
    islandShape(
      island,
      plateaux.filter(
        (other, at) => at !== index && rectDistance(island.plateau, other) < NEIGHBOUR_REACH,
      ),
    ),
  )
}

function rectDistance(a: Rect, b: Rect): number {
  const dx = Math.max(a.x - (b.x + b.width), 0, b.x - (a.x + a.width))
  const dy = Math.max(a.y - (b.y + b.height), 0, b.y - (a.y + a.height))
  return Math.hypot(dx, dy)
}

/** The altitudes of an island's rings, from its plateau down to its beach. */
export function ringAltitudes(layer: number): number[] {
  const plateau = layerAltitude(layer)
  // As many terraces as the layer: the last one is the beach.
  const terraces = clampLayer(layer)
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
  const { x: x0, y: y0, width, height } = island.plateau
  const x1 = x0 + width
  const y1 = y0 + height
  const perimeter = 2 * width + 2 * height + 4 * CORNER_LENGTH
  // One wobble for the plateau's edge, one for each terrace: no step just copies the one above.
  const edgeWobble = wobbleAlong(`island/${island.path}`, perimeter)
  const ringWobbles = Array.from({ length: terraces }, (_, ring) =>
    wobbleAlong(`terraces/${island.path}/${ring}`, perimeter),
  )

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

  // First the points around the plateau, with what each one faces.
  interface Point {
    x: number
    y: number
    nx: number
    ny: number
    position: number
    factor: number
    nearest: number
    bulge: number
  }
  const points: Point[] = []
  const add = (position: number, x: number, y: number, nx: number, ny: number, bulge = 0) => {
    let nearest = Number.POSITIVE_INFINITY
    let ahead = Number.POSITIVE_INFINITY
    for (const other of others) {
      nearest = Math.min(nearest, distanceToRect(x, y, other))
      ahead = Math.min(ahead, distanceAhead(x, y, nx, ny, other))
    }
    points.push({ x, y, nx, ny, position, factor: sideFactor(ahead), nearest, bulge })
  }
  const order: Side[] = ['south', 'east', 'north', 'west']
  for (const side of order) {
    const { start, from, normal } = sides[side]
    const [dx, dy] = directions[side]
    const length = side === 'south' || side === 'north' ? width : height
    const steps = Math.max(1, Math.round(length / SAMPLE_STEP))
    const swell = Math.min(BULGE_SHARE * length, BULGE_MAX)
    for (let i = 0; i <= steps; i++) {
      const along = (length * i) / steps
      add(
        start + along,
        from[0] + dx * along,
        from[1] + dy * along,
        normal[0],
        normal[1],
        swell * Math.sin((Math.PI * i) / steps),
      )
    }
    // The corner after this side turns the normal toward the next side's.
    const cornerX = from[0] + dx * length
    const cornerY = from[1] + dy * length
    const base = Math.atan2(normal[1], normal[0])
    for (let m = 1; m <= CORNER_SAMPLES; m++) {
      const turn = m / (CORNER_SAMPLES + 1)
      const angle = base + (Math.PI / 2) * turn
      add(start + length + CORNER_LENGTH * turn, cornerX, cornerY, Math.cos(angle), Math.sin(angle))
    }
  }

  // Then the rings, from the side factor averaged along the edge (a tent, around the island).
  // Points are in order around the edge: only those within the tent are visited, both ways.
  const count = points.length
  const samples: ContourSample[] = points.map((point, index) => {
    let weighted = point.factor
    let weights = 1
    // Back only over the points forward did not reach: a tiny edge fits whole in the tent.
    let left = count - 1
    for (const step of [1, -1]) {
      for (let k = 1; k <= left; k++) {
        const other = points[(index + step * k + count) % count]
        if (!other) {
          break
        }
        const apart = Math.abs(other.position - point.position)
        const distance = Math.min(apart, perimeter - apart)
        if (distance >= FACTOR_SMOOTHING) {
          break
        }
        const weight = 1 - distance / FACTOR_SMOOTHING
        weighted += weight * other.factor
        weights += weight
        if (step > 0) {
          left--
        }
      }
    }
    const factor = weighted / weights
    // A side swells out to the open sea only, not toward an island facing it.
    const open = (factor - FACING_FACTOR) / (OPEN_SEA_FACTOR - FACING_FACTOR)
    return {
      x: point.x,
      y: point.y,
      nx: point.nx,
      ny: point.ny,
      offsets: ringOffsets(
        edgeWobble(point.position),
        ringWobbles.map((wobble) => wobble(point.position)),
        factor,
        point.nearest,
        terraces,
        point.bulge * Math.min(Math.max(open, 0), 1),
      ),
    }
  })

  // A loop, not a spread: a huge plateau has more samples than a call takes arguments.
  let reach = 0
  for (const sample of samples) {
    reach = Math.max(reach, sample.offsets[terraces] ?? 0)
  }
  const positions = points.map((point) => point.position)
  return {
    island,
    altitudes,
    samples,
    reach,
    canals: islandCanals(island),
    // Between two samples, as the cliffs and terraces drawn from them are.
    offsetsAt(side, along) {
      const position = sides[side].start + along
      let next = positions.findIndex((value) => value > position)
      if (next < 0) {
        next = 0
      }
      const previous = (next - 1 + positions.length) % positions.length
      const from = positions[previous] ?? 0
      let to = positions[next] ?? 0
      if (to <= from) {
        to += perimeter
      }
      const t = to > from ? Math.min(Math.max((position - from) / (to - from), 0), 1) : 0
      const a = samples[previous]?.offsets ?? []
      const b = samples[next]?.offsets ?? []
      return a.map((value, ring) => value + ((b[ring] ?? value) - value) * t)
    },
  }
}

/** How wide the terraces are where the island ahead is `ahead` u away: narrow when it is close. */
function sideFactor(ahead: number): number {
  return FACING_FACTOR + (OPEN_SEA_FACTOR - FACING_FACTOR) * smoothstep(ahead)
}

/**
 * The offsets of the plateau's edge and of each terrace, at a point of the edge where the
 * wobbles are `edgeWobble` and `ringWobbles` (0 to 1, one per terrace), each terrace about
 * `factor` u wide, the nearest island `nearest` u away, and the terraces swelling out by
 * `bulge` u in all.
 */
function ringOffsets(
  edgeWobble: number,
  ringWobbles: readonly number[],
  factor: number,
  nearest: number,
  terraces: number,
  bulge = 0,
): number[] {
  // Two neighbours share the water between them: each beach keeps to its half, foam included.
  // Alone on the sea, nothing to share: nearest is infinite.
  const free = Number.isFinite(nearest)
    ? Math.max(FREE_WATER, FREE_WATER_SHARE * nearest)
    : FREE_WATER
  const limit = nearest / 2 - FOAM_WIDTH - free
  const amplitude = Math.min(
    Math.max((limit - EDGE_OFFSET) * EDGE_WOBBLE_SHARE, EDGE_WOBBLE[0]),
    EDGE_WOBBLE[1],
  )
  const edge = EDGE_OFFSET + amplitude * edgeWobble
  // Each terrace its own width, 0.4 to 1.6 times the factor: never nothing, so rings never cross.
  const rings: number[] = []
  let ring = edge
  for (let index = 0; index < terraces; index++) {
    ring += factor * (0.4 + 1.2 * (ringWobbles[index] ?? 0.5)) + bulge / terraces
    rings.push(ring)
  }
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

/**
 * The design's edge noise, in [0, 1], at a position `s` u along the edge: three seeded waves of
 * about 53, 29 and 13 u, each a whole number of times around the island so that it closes.
 */
function wobbleAlong(seed: string, perimeter: number): (s: number) => number {
  const random = seededRandom(seed)
  const weights = [0.25, 0.15, 0.1]
  const waves = WOBBLE_WAVELENGTHS.map((wavelength, index) => ({
    k: (2 * Math.PI * Math.max(1, Math.round(perimeter / wavelength))) / perimeter,
    phase: random() * Math.PI * 2,
    weight: weights[index] ?? 0,
  }))
  return (s) =>
    0.5 + waves.reduce((sum, wave) => sum + wave.weight * Math.sin(wave.k * s + wave.phase), 0)
}
