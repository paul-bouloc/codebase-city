import type { Vec3 } from '../world/units'
import type { Archetype, Building } from './archetypes'
import {
  box,
  type Face,
  HEIGHT,
  INK,
  type Length,
  length,
  type Paint,
  type Part,
  type Point,
  plus,
  ROOF,
  SIDE,
  SPLIT,
  square,
  TRIM,
  times,
  WALL,
  ZERO,
} from './parts'
import { variantParts } from './variant-shapes'
import type { VariantArchetype } from './variants-kit'

// Every archetype is one geometry shared by all its instances, made of the parts in `parts.ts`.

function smallBlock(): Part[] {
  return [
    square(ZERO, ZERO, SIDE, ZERO, HEIGHT, WALL, ROOF),
    square(
      times(SIDE, 0.2),
      times(SIDE, -0.2),
      length(0.42),
      HEIGHT,
      plus(HEIGHT, length(0.3)),
      TRIM,
      TRIM,
    ),
  ]
}

function setbackBlock(): Part[] {
  return [
    square(ZERO, ZERO, SIDE, ZERO, SPLIT, WALL, ROOF),
    square(ZERO, ZERO, plus(SIDE, length(-2 * 0.16)), SPLIT, HEIGHT, WALL, ROOF),
    square(
      times(SIDE, -0.15),
      times(SIDE, 0.12),
      length(0.36),
      HEIGHT,
      plus(HEIGHT, length(0.28)),
      TRIM,
      TRIM,
    ),
  ]
}

function pyramidRoof(): Part[] {
  const shaft = times(SIDE, 0.84)
  const half = times(plus(shaft, length(0.08)), 0.5)
  const low = times(half, -1)
  // Fixed pitch: a taller building gets a taller shaft, never a taller roof.
  const apex: Point = [ZERO, ZERO, plus(HEIGHT, times(shaft, 0.62))]
  const eave = (x: Length, y: Length): Point => [x, y, HEIGHT]
  return [
    square(ZERO, ZERO, shaft, ZERO, HEIGHT, WALL, ROOF),
    {
      centre: [ZERO, ZERO, plus(HEIGHT, times(shaft, 0.62 * 0.3))],
      faces: [
        { paint: ROOF, points: [eave(low, low), eave(half, low), apex] },
        { paint: ROOF, points: [eave(half, low), eave(half, half), apex] },
        { paint: ROOF, points: [eave(half, half), eave(low, half), apex] },
        { paint: ROOF, points: [eave(low, half), eave(low, low), apex] },
      ],
    },
  ]
}

function towerOnPodium(): Part[] {
  const podium = length(3 * 0.5)
  const crown = plus(HEIGHT, length(0.35))
  return [
    square(ZERO, ZERO, SIDE, ZERO, podium, WALL, ROOF),
    square(ZERO, ZERO, times(SIDE, 0.62), podium, HEIGHT, WALL, ROOF),
    square(ZERO, ZERO, times(SIDE, 0.44), HEIGHT, crown, TRIM, ROOF),
    square(ZERO, ZERO, length(0.06), crown, plus(crown, length(1.2)), INK, INK),
  ]
}

// A Hall needs a side of 1.5 u at least, so its 1.8 × 1.08 u cap always applies.
const HALL_LENGTH = 1.8
const HALL_DEPTH = 1.08
const HALL_TEETH = 4
const TOOTH_HEIGHT = 0.28

function hall(): Part[] {
  const tooth = HALL_LENGTH / HALL_TEETH
  const y0 = length(-HALL_DEPTH / 2)
  const y1 = length(HALL_DEPTH / 2)
  const top = plus(HEIGHT, length(TOOTH_HEIGHT))
  const teeth = Array.from({ length: HALL_TEETH }, (_, index): Part => {
    const xa = length(-HALL_LENGTH / 2 + index * tooth)
    const xb = length(-HALL_LENGTH / 2 + (index + 1) * tooth)
    return {
      centre: [
        length(-HALL_LENGTH / 2 + (index + 0.5) * tooth),
        ZERO,
        plus(HEIGHT, length(TOOTH_HEIGHT / 3)),
      ],
      faces: [
        {
          paint: ROOF,
          points: [
            [xa, y0, HEIGHT],
            [xb, y0, top],
            [xb, y1, top],
            [xa, y1, HEIGHT],
          ],
        },
        {
          paint: TRIM,
          points: [
            [xb, y0, HEIGHT],
            [xb, y1, HEIGHT],
            [xb, y1, top],
            [xb, y0, top],
          ],
        },
        {
          paint: WALL,
          points: [
            [xa, y1, HEIGHT],
            [xb, y1, HEIGHT],
            [xb, y1, top],
          ],
        },
        {
          paint: WALL,
          points: [
            [xb, y0, HEIGHT],
            [xa, y0, HEIGHT],
            [xb, y0, top],
          ],
        },
      ],
    }
  })
  return [
    box(ZERO, ZERO, length(HALL_LENGTH), length(HALL_DEPTH), ZERO, HEIGHT, WALL, ROOF),
    ...teeth,
  ]
}

/** The archetypes of one model each; the low ones are assembled from their pieces. */
const SHAPES: Record<Exclude<Archetype, VariantArchetype>, () => Part[]> = {
  hall,
  smallBlock,
  setbackBlock,
  pyramidRoof,
  towerOnPodium,
}

/** What a geometry depends on: buildings of one shape share one draw call. */
export type Shape = Pick<Building, 'archetype' | 'pieces'>

export const shapeKey = ({ archetype, pieces }: Shape): string =>
  pieces.length > 0 ? `${archetype}:${pieces.join('.')}` : archetype

function isVariant(archetype: Archetype): archetype is VariantArchetype {
  return archetype === 'house' || archetype === 'pavilion' || archetype === 'concreteBlock'
}

/** A vertex in three.js coordinates (y up). */
export interface Vertex {
  /** The fixed part, in u. */
  position: Vec3
  /** How the vertex moves per u of side. */
  sideFactor: Vec3
  /** How the vertex rises per u of height and per u of split. */
  heightFactor: [number, number]
  /** Flat, from a typical building: stretching barely tilts a roof. */
  normal: Vec3
  /** rgb and amount: the vertex colour is `mix(language, rgb, amount)`. */
  paint: [number, number, number, number]
  /**
   * Barycentric: component j falls to 0 on the side facing vertex j. A side that cuts across
   * its face (a diagonal of the fan) keeps 1 at every vertex, so it never draws a line.
   */
  edge: Vec3
  /** 1 on the face a generated file's three bars are stamped on, 0 elsewhere. */
  stamped: number
  /** The middle of that face, in three.js x and z: fixed, then per u of side. */
  stampCentre: [number, number, number, number]
}

export type Triangle = [Vertex, Vertex, Vertex]

type Corner = Omit<Vertex, 'edge'>

/** `outline[j]`: the side facing vertex j lies on the face's outline. */
function withEdges(
  corners: [Corner, Corner, Corner],
  outline: [boolean, boolean, boolean],
): Triangle {
  return corners.map((corner, k) => ({
    ...corner,
    edge: outline.map((onOutline, j) => (j === k || !onOutline ? 1 : 0)) as Vec3,
  })) as Triangle
}

const TYPICAL: Building = { archetype: 'smallBlock', side: 1.4, height: 3, split: 2, pieces: [] }

function evaluate(value: Length, { side, height, split }: Building): number {
  return value[0] + value[1] * side + value[2] * height + value[3] * split
}

function at(point: Point, building: Building): Vec3 {
  return [evaluate(point[0], building), evaluate(point[1], building), evaluate(point[2], building)]
}

/** Newell's normal: follows the winding of a planar polygon. */
function windingNormal(points: Vec3[]): Vec3 {
  const normal: Vec3 = [0, 0, 0]
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length] ?? a
    normal[0] += (a[1] - b[1]) * (a[2] + b[2])
    normal[1] += (a[2] - b[2]) * (a[0] + b[0])
    normal[2] += (a[0] - b[0]) * (a[1] + b[1])
  })
  const size = Math.hypot(...normal)
  return [normal[0] / size, normal[1] / size, normal[2] / size]
}

/** Where the bars of a stamped face are centred: on the middle of its corners. */
interface Stamp {
  stamped: number
  stampCentre: [number, number, number, number]
}

const UNSTAMPED: Stamp = { stamped: 0, stampCentre: [0, 0, 0, 0] }
const CENTRED: Stamp = { stamped: 1, stampCentre: [0, 0, 0, 0] }

function stampOf({ points, stampCentre }: Face): Stamp {
  const average = (axis: 0 | 1, k: 0 | 1) =>
    stampCentre
      ? stampCentre[axis][k]
      : points.reduce((sum, point) => sum + point[axis][k], 0) / points.length
  // Board y is three.js −z
  return { stamped: 1, stampCentre: [average(0, 0), average(0, 1), -average(1, 0), -average(1, 1)] }
}

function vertex([x, y, z]: Point, normal: Vec3, paint: Paint, stamp: Stamp): Corner {
  if (x[2] !== 0 || x[3] !== 0 || y[2] !== 0 || y[3] !== 0) {
    throw new Error('A footprint cannot follow the height')
  }
  // Board (x, y, z up) to three.js (x, z, −y).
  return {
    position: [x[0], z[0], -y[0]],
    sideFactor: [x[1], z[1], -y[1]],
    heightFactor: [z[2], z[3]],
    normal: [normal[0], normal[2], -normal[1]],
    paint: [...paint.colour, paint.amount],
    ...stamp,
  }
}

const geometries = new Map<string, Triangle[]>()

/** The triangles of a shape, each turned outwards; built once per shape. */
export function buildingGeometry(shape: Shape): Triangle[] {
  const key = shapeKey(shape)
  const known = geometries.get(key)
  if (known) {
    return known
  }
  const { archetype, pieces } = shape
  const triangles = isVariant(archetype)
    ? trianglesOf(variantParts(archetype, pieces), true)
    : trianglesOf(SHAPES[archetype](), false)
  geometries.set(key, triangles)
  return triangles
}

/**
 * The parts' triangles. `marked`: the parts mark the face a generated file is stamped on;
 * otherwise every face turned up is.
 */
function trianglesOf(parts: Part[], marked: boolean): Triangle[] {
  const triangles: Triangle[] = []
  for (const part of parts) {
    const centre = at(part.centre, TYPICAL)
    for (const face of part.faces) {
      const corners = face.points.map((point) => at(point, TYPICAL))
      let normal = windingNormal(corners)
      let [first, ...rest] = face.points
      const [corner] = corners
      if (!first || !corner) {
        continue
      }
      const outward =
        normal[0] * (corner[0] - centre[0]) +
        normal[1] * (corner[1] - centre[1]) +
        normal[2] * (corner[2] - centre[2])
      if (outward < 0) {
        rest = rest.reverse()
        normal = [-normal[0], -normal[1], -normal[2]]
      }
      // Bars on a face of one model stay centred on the building, as they always were
      const stamp = marked
        ? face.stamp
          ? stampOf(face)
          : UNSTAMPED
        : normal[2] > 0.5
          ? CENTRED
          : UNSTAMPED
      const apex = vertex(first, normal, face.paint, stamp)
      rest.forEach((point, i) => {
        const next = rest[i + 1]
        if (next) {
          // A fan from the apex: the far side is always outline, the sides from the apex only
          // for the first and last triangles.
          triangles.push(
            withEdges(
              [
                apex,
                vertex(point, normal, face.paint, stamp),
                vertex(next, normal, face.paint, stamp),
              ],
              [true, i + 2 === rest.length, i === 0],
            ),
          )
        }
      })
    }
  }
  return triangles
}

/** Where a vertex lands around its lot's centre: what the vertex shader computes. */
export function stretched(
  { position, sideFactor, heightFactor }: Vertex,
  { side, height, split }: Building,
): Vec3 {
  return [
    position[0] + sideFactor[0] * side,
    position[1] + sideFactor[1] * side + heightFactor[0] * height + heightFactor[1] * split,
    position[2] + sideFactor[2] * side,
  ]
}
