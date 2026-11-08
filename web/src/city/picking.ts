import { buildingGeometry, shapeKey, type Vertex } from './buildings/archetype-geometry'
import type { PlacedBuilding } from './buildings/placed-buildings'
import type { IslandShape } from './terrain/island-shape'
import { rectContains } from './world/layout'
import type { Vec3 } from './world/units'

/** What the pointer can rest on. */
export type CityTarget =
  /** A building, by its index among the placed buildings. */
  | { kind: 'building'; index: number }
  | { kind: 'island'; island: number }
  /** A folder inside an island, by its index among the island's parcels. */
  | { kind: 'parcel'; island: number; parcel: number }

/** A ray in three.js coordinates; the direction need not be of length 1. */
export interface Ray {
  origin: Vec3
  direction: Vec3
}

/** Six numbers per box: min x, y, z, then max x, y, z. */
const BOX = 6

/**
 * A building the ray passes near counts only if it stands no further along the ray than this
 * past the ground the ray meets, in u: the building beside the point aimed at, not one on an
 * island behind.
 */
const NEAR_GROUND = 3

interface IslandBoxes {
  /** Its buildings' boxes, and their indices among the placed buildings. */
  boxes: Float64Array
  indices: number[]
  /** Around all of them and the terrain, down to the beach. */
  bounds: Float64Array
  /** Each ring's outline on the board, x then y for each point: the plateau's edge first. */
  rings: Float64Array[]
}

/**
 * Finds what a ray meets first: a building (its box), or else the ground of an island, its
 * plateau (and on it the deepest folder's parcel), a terrace or the beach. Islands whose box the
 * ray misses are skipped whole. With some slack, a ray that meets no building but passes near
 * one takes it: a building a few pixels across on screen need not be hit exactly.
 */
export class CityPicker {
  private readonly islands: IslandBoxes[]

  constructor(
    private readonly shapes: readonly IslandShape[],
    placed: readonly PlacedBuilding[],
  ) {
    const local = new Map<string, Vertex[]>()
    const members = shapes.map(() => [] as number[])
    placed.forEach(({ island }, index) => {
      members[island]?.push(index)
    })
    this.islands = shapes.map(({ island, altitudes, samples, reach }, at) => {
      const indices = members[at] ?? []
      const boxes = new Float64Array(indices.length * BOX)
      const top = altitudes[0] ?? 0
      const bottom = altitudes.at(-1) ?? top
      const { x, y, width, height } = island.plateau
      // The terrain, in three.js coordinates: board y runs along −z.
      const bounds = Float64Array.of(
        x - reach,
        bottom,
        -(y + height) - reach,
        x + width + reach,
        top,
        -y + reach,
      )
      const rings = altitudes.map((_, ring) => {
        const outline = new Float64Array(samples.length * 2)
        samples.forEach(({ x, y, nx, ny, offsets }, at) => {
          const out = offsets[ring] ?? 0
          outline[at * 2] = x + nx * out
          outline[at * 2 + 1] = y + ny * out
        })
        return outline
      })
      indices.forEach((index, row) => {
        const building = placed[index] as PlacedBuilding
        const key = shapeKey(building.building)
        let vertices = local.get(key)
        if (!vertices) {
          vertices = buildingGeometry(building.building).flat()
          local.set(key, vertices)
        }
        boxOf(building, vertices, boxes, row * BOX)
        for (let axis = 0; axis < 3; axis++) {
          bounds[axis] = Math.min(bounds[axis] as number, boxes[row * BOX + axis] as number)
          bounds[axis + 3] = Math.max(
            bounds[axis + 3] as number,
            boxes[row * BOX + axis + 3] as number,
          )
        }
      })
      return { boxes, indices, bounds, rings }
    })
  }

  /**
   * What the ray meets first. `slack` is how far from the ray a building may stand and still be
   * taken, in u per u along the ray: an angle, a few pixels' worth.
   */
  pick(ray: Ray, slack = 0): CityTarget | null {
    const origin = ray.origin
    const length = Math.hypot(...ray.direction)
    const direction: Vec3 = [
      ray.direction[0] / length,
      ray.direction[1] / length,
      ray.direction[2] / length,
    ]
    const inverse: Vec3 = [1 / direction[0], 1 / direction[1], 1 / direction[2]]
    let nearest = Number.POSITIVE_INFINITY
    let target = null as CityTarget | null
    // The building the ray passes nearest to, as a share of the slack, and how far along it.
    let close = null as { index: number; share: number; t: number } | null
    for (let island = 0; island < this.islands.length; island++) {
      const { boxes, indices, bounds } = this.islands[island] as IslandBoxes
      const grow = slack > 0 ? slack * farthest(bounds, origin) : 0
      const enter = hitBox(bounds, 0, origin, inverse, grow)
      if (enter === null || enter >= nearest) {
        continue
      }
      for (let row = 0; row < indices.length; row++) {
        const index = indices[row] as number
        const t = hitBox(boxes, row * BOX, origin, inverse)
        if (t !== null) {
          if (t < nearest) {
            nearest = t
            target = { kind: 'building', index }
          }
          continue
        }
        const miss = slack > 0 ? missOf(boxes, row * BOX, origin, direction) : null
        const share = miss ? miss.distance / (slack * miss.t) : Number.POSITIVE_INFINITY
        if (miss && share <= 1 && (!close || share < close.share)) {
          close = { index, share, t: miss.t }
        }
      }
      const ground = this.ground(island, origin, direction)
      if (ground && ground.t < nearest) {
        nearest = ground.t
        target = ground.target
      }
    }
    // Nothing hit exactly: a building close by wins over the ground around it.
    if (close && target?.kind !== 'building' && close.t <= nearest + NEAR_GROUND) {
      return { kind: 'building', index: close.index }
    }
    return target
  }

  /**
   * How high the ground stands at a point of three.js's ground plane: the plateau, a terrace or
   * the beach of the island there, each taken as flat at its top; 0 at sea. Buildings aside.
   */
  groundHeight(x: number, z: number): number {
    const y = -z
    for (let index = 0; index < this.islands.length; index++) {
      const { bounds, rings } = this.islands[index] as IslandBoxes
      const shape = this.shapes[index]
      if (
        !shape ||
        x < (bounds[0] as number) ||
        x > (bounds[3] as number) ||
        z < (bounds[2] as number) ||
        z > (bounds[5] as number)
      ) {
        continue
      }
      const { island, altitudes } = shape
      for (let ring = 0; ring < altitudes.length; ring++) {
        if (
          (ring === 0 && rectContains(island.plateau, x, y)) ||
          insideOutline(rings[ring] as Float64Array, x, y)
        ) {
          return altitudes[ring] as number
        }
      }
    }
    return 0
  }

  /**
   * Where the ray meets an island's ground, from the top: its plateau and the deepest folder
   * there, else a terrace or the beach, each taken as flat at its top.
   */
  private ground(
    index: number,
    origin: Vec3,
    direction: Vec3,
  ): { t: number; target: CityTarget } | null {
    const shape = this.shapes[index]
    const rings = this.islands[index]?.rings
    if (!shape || !rings || direction[1] >= 0) {
      return null
    }
    const { island, altitudes } = shape
    for (let ring = 0; ring < altitudes.length; ring++) {
      const t = ((altitudes[ring] as number) - origin[1]) / direction[1]
      if (t < 0) {
        continue
      }
      const x = origin[0] + t * direction[0]
      const y = -(origin[2] + t * direction[2])
      if (ring === 0 && rectContains(island.plateau, x, y)) {
        // Outer parcels come first: the last one that holds the point is the deepest.
        for (let parcel = island.parcels.length - 1; parcel >= 0; parcel--) {
          const { rect, path } = island.parcels[parcel] ?? {}
          if (rect && path !== undefined && rectContains(rect, x, y)) {
            return { t, target: { kind: 'parcel', island: index, parcel } }
          }
        }
        return { t, target: { kind: 'island', island: index } }
      }
      if (insideOutline(rings[ring] as Float64Array, x, y)) {
        return { t, target: { kind: 'island', island: index } }
      }
    }
    return null
  }
}

/** The distance from a point to the farthest corner of a box, at most. */
function farthest(box: Float64Array, point: Vec3): number {
  let sum = 0
  for (let axis = 0; axis < 3; axis++) {
    const p = point[axis] as number
    const reach = Math.max(
      Math.abs(p - (box[axis] as number)),
      Math.abs(p - (box[axis + 3] as number)),
    )
    sum += reach * reach
  }
  return Math.sqrt(sum)
}

/**
 * How far a ray (of unit direction) passes from a box: from its point level with the box's
 * middle to the box. Null if the box lies behind.
 */
function missOf(
  boxes: Float64Array,
  at: number,
  origin: Vec3,
  direction: Vec3,
): { distance: number; t: number } | null {
  let t = 0
  for (let axis = 0; axis < 3; axis++) {
    const middle = ((boxes[at + axis] as number) + (boxes[at + axis + 3] as number)) / 2
    t += (middle - (origin[axis] as number)) * (direction[axis] as number)
  }
  if (t <= 0) {
    return null
  }
  let sum = 0
  for (let axis = 0; axis < 3; axis++) {
    const p = (origin[axis] as number) + t * (direction[axis] as number)
    const low = boxes[at + axis] as number
    const high = boxes[at + axis + 3] as number
    const out = p < low ? low - p : p > high ? p - high : 0
    sum += out * out
  }
  return { distance: Math.sqrt(sum), t }
}

/** Whether a board point lies inside a closed outline (x then y for each point). */
function insideOutline(outline: Float64Array, x: number, y: number): boolean {
  let inside = false
  const count = outline.length / 2
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const xi = outline[i * 2] as number
    const yi = outline[i * 2 + 1] as number
    const xj = outline[j * 2] as number
    const yj = outline[j * 2 + 1] as number
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/** A building's box around its stretched, turned shape, written at `at`. */
function boxOf(
  { building, position, angle }: PlacedBuilding,
  vertices: readonly Vertex[],
  out: Float64Array,
  at: number,
): void {
  const { side, height, split } = building
  let minX = 0
  let maxX = 0
  let minZ = 0
  let maxZ = 0
  let top = 0
  for (const { position: p, sideFactor: s, heightFactor: h } of vertices) {
    const x = p[0] + s[0] * side
    const z = p[2] + s[2] * side
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
    top = Math.max(top, p[1] + s[1] * side + h[0] * height + h[1] * split)
  }
  // Turned about y as three.js does: x' = x cos + z sin, z' = z cos − x sin.
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  let lowX = Number.POSITIVE_INFINITY
  let highX = Number.NEGATIVE_INFINITY
  let lowZ = Number.POSITIVE_INFINITY
  let highZ = Number.NEGATIVE_INFINITY
  for (const x of [minX, maxX]) {
    for (const z of [minZ, maxZ]) {
      const tx = x * cos + z * sin
      const tz = z * cos - x * sin
      lowX = Math.min(lowX, tx)
      highX = Math.max(highX, tx)
      lowZ = Math.min(lowZ, tz)
      highZ = Math.max(highZ, tz)
    }
  }
  out.set(
    [
      position[0] + lowX,
      position[1],
      position[2] + lowZ,
      position[0] + highX,
      position[1] + top,
      position[2] + highZ,
    ],
    at,
  )
}

/** Where a ray enters a box grown by `grow` (0 if it starts inside), or null if it misses it. */
function hitBox(
  boxes: Float64Array,
  at: number,
  origin: Vec3,
  inverse: Vec3,
  grow = 0,
): number | null {
  let near = 0
  let far = Number.POSITIVE_INFINITY
  for (let axis = 0; axis < 3; axis++) {
    const o = origin[axis] as number
    const k = inverse[axis] as number
    const low = (boxes[at + axis] as number) - grow
    const high = (boxes[at + axis + 3] as number) + grow
    if (!Number.isFinite(k)) {
      // Parallel to this axis: inside its slab or never.
      if (o < low || o > high) {
        return null
      }
      continue
    }
    let t0 = (low - o) * k
    let t1 = (high - o) * k
    if (t0 > t1) {
      ;[t0, t1] = [t1, t0]
    }
    near = Math.max(near, t0)
    far = Math.min(far, t1)
    if (near > far) {
      return null
    }
  }
  return near
}
