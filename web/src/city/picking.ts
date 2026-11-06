import { buildingGeometry, shapeKey, type Vertex } from './archetype-geometry'
import type { CityLayout, Rect } from './layout'
import type { PlacedBuilding } from './placed-buildings'
import { layerAltitude, type Vec3 } from './units'

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

interface IslandBoxes {
  /** Its buildings' boxes, and their indices among the placed buildings. */
  boxes: Float64Array
  indices: number[]
  /** Around all of them and the plateau. */
  bounds: Float64Array
}

/**
 * Finds what a ray meets first: a building (its box), or else the plateau of an island, and on
 * it the deepest folder's parcel. Islands whose box the ray misses are skipped whole.
 */
export class CityPicker {
  private readonly islands: IslandBoxes[]

  constructor(
    private readonly layout: CityLayout,
    placed: readonly PlacedBuilding[],
  ) {
    const local = new Map<string, Vertex[]>()
    const members = layout.islands.map(() => [] as number[])
    placed.forEach(({ island }, index) => {
      members[island]?.push(index)
    })
    this.islands = layout.islands.map((island, at) => {
      const indices = members[at] ?? []
      const boxes = new Float64Array(indices.length * BOX)
      const altitude = layerAltitude(island.layer)
      const { x, y, width, height } = island.plateau
      // The plateau's top, in three.js coordinates: board y runs along −z.
      const bounds = Float64Array.of(x, altitude, -(y + height), x + width, altitude, -y)
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
      return { boxes, indices, bounds }
    })
  }

  pick({ origin, direction }: Ray): CityTarget | null {
    const inverse: Vec3 = [1 / direction[0], 1 / direction[1], 1 / direction[2]]
    let nearest = Number.POSITIVE_INFINITY
    let target: CityTarget | null = null
    this.islands.forEach(({ boxes, indices, bounds }, island) => {
      const enter = hitBox(bounds, 0, origin, inverse)
      if (enter === null || enter >= nearest) {
        return
      }
      for (let row = 0; row < indices.length; row++) {
        const t = hitBox(boxes, row * BOX, origin, inverse)
        if (t !== null && t < nearest) {
          nearest = t
          target = { kind: 'building', index: indices[row] as number }
        }
      }
      const ground = this.ground(island, origin, direction)
      if (ground && ground.t < nearest) {
        nearest = ground.t
        target = ground.target
      }
    })
    return target
  }

  /** Where the ray meets an island's plateau, and the deepest folder there. */
  private ground(
    index: number,
    origin: Vec3,
    direction: Vec3,
  ): { t: number; target: CityTarget } | null {
    const island = this.layout.islands[index]
    if (!island || direction[1] >= 0) {
      return null
    }
    const t = (layerAltitude(island.layer) - origin[1]) / direction[1]
    if (t < 0) {
      return null
    }
    const x = origin[0] + t * direction[0]
    const y = -(origin[2] + t * direction[2])
    if (!inside(island.plateau, x, y)) {
      return null
    }
    // Outer parcels come first: the last one that holds the point is the deepest.
    for (let parcel = island.parcels.length - 1; parcel >= 0; parcel--) {
      const { rect, path } = island.parcels[parcel] ?? {}
      if (rect && path !== undefined && inside(rect, x, y)) {
        return { t, target: { kind: 'parcel', island: index, parcel } }
      }
    }
    return { t, target: { kind: 'island', island: index } }
  }
}

function inside(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
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

/** Where a ray enters a box (0 if it starts inside), or null if it misses it. */
function hitBox(boxes: Float64Array, at: number, origin: Vec3, inverse: Vec3): number | null {
  let near = 0
  let far = Number.POSITIVE_INFINITY
  for (let axis = 0; axis < 3; axis++) {
    const o = origin[axis] as number
    const k = inverse[axis] as number
    const low = boxes[at + axis] as number
    const high = boxes[at + axis + 3] as number
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
