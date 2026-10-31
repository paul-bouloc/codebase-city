import type { Archetype, Building } from './archetypes'
import { mixSrgb, srgb, type Vec3 } from './units'

// Every archetype is one geometry shared by all its instances. A vertex coordinate is a length
// `fixed + side × s + height × h + split × k`, where s, h and k come from the instance: what
// should stretch follows the instance, what should not (kiosks, antennas, roof pitches, teeth)
// keeps its size in u. The vertex shader adds the parts up.

/** [fixed, side, height, split] coefficients, in u. */
type Length = readonly [number, number, number, number]
/** Board coordinates: x, y on the ground, z up. */
type Point = readonly [Length, Length, Length]

const length = (fixed: number, side = 0, height = 0, split = 0): Length => [
  fixed,
  side,
  height,
  split,
]
const plus = (a: Length, b: Length): Length => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]]
const times = (a: Length, factor: number): Length => [
  a[0] * factor,
  a[1] * factor,
  a[2] * factor,
  a[3] * factor,
]
const ZERO = length(0)
const SIDE = length(0, 1)
const HEIGHT = length(0, 0, 1)
const SPLIT = length(0, 0, 0, 1)

/** A face's colour: `mix(language, colour, amount)`, in sRGB. */
interface Paint {
  colour: Vec3
  amount: number
}

const WHITE = srgb('#FFFFFF')
const WALL: Paint = { colour: WHITE, amount: 0.58 }
const ROOF: Paint = { colour: WHITE, amount: 0 }
const TRIM: Paint = { colour: WHITE, amount: 0.35 }
const fixedPaint = (colour: Vec3): Paint => ({ colour, amount: 1 })

const INK = fixedPaint(srgb('#23313A'))
const WOOD = '#B98B5E'
const FLOOR_SIDES = fixedPaint(mixSrgb(WOOD, '#000000', 0.15))
const FLOOR_TOP = fixedPaint(mixSrgb(WOOD, '#FFFFFF', 0.2))
const POST = fixedPaint(mixSrgb(WOOD, '#000000', 0.2))
const ROOF_EDGE = fixedPaint(mixSrgb(WOOD, '#000000', 0.1))

interface Face {
  points: Point[]
  paint: Paint
}

/** Faces that close around `centre`: it tells their outside. */
interface Part {
  faces: Face[]
  centre: Point
}

/** A box without a bottom, centred on (x, y), from z0 to z1. */
function box(
  x: Length,
  y: Length,
  width: Length,
  depth: Length,
  z0: Length,
  z1: Length,
  wall: Paint,
  roof: Paint,
): Part {
  const x0 = plus(x, times(width, -0.5))
  const x1 = plus(x, times(width, 0.5))
  const y0 = plus(y, times(depth, -0.5))
  const y1 = plus(y, times(depth, 0.5))
  const corner = (cx: Length, cy: Length, z: Length): Point => [cx, cy, z]
  return {
    centre: [x, y, times(plus(z0, z1), 0.5)],
    faces: [
      {
        paint: roof,
        points: [corner(x0, y0, z1), corner(x1, y0, z1), corner(x1, y1, z1), corner(x0, y1, z1)],
      },
      {
        paint: wall,
        points: [corner(x1, y0, z0), corner(x1, y1, z0), corner(x1, y1, z1), corner(x1, y0, z1)],
      },
      {
        paint: wall,
        points: [corner(x0, y1, z0), corner(x0, y0, z0), corner(x0, y0, z1), corner(x0, y1, z1)],
      },
      {
        paint: wall,
        points: [corner(x1, y1, z0), corner(x0, y1, z0), corner(x0, y1, z1), corner(x1, y1, z1)],
      },
      {
        paint: wall,
        points: [corner(x0, y0, z0), corner(x1, y0, z0), corner(x1, y0, z1), corner(x0, y0, z1)],
      },
    ],
  }
}

/** A cube of `size` u on a stretching footprint and height. */
const square = (
  x: Length,
  y: Length,
  size: Length,
  z0: Length,
  z1: Length,
  wall: Paint,
  roof: Paint,
) => box(x, y, size, size, z0, z1, wall, roof)

function house(): Part[] {
  const depth = times(SIDE, 0.74)
  const roofWidth = plus(SIDE, length(0.08))
  const roofDepth = plus(depth, length(0.08))
  // 40° pitch: the roof's height follows the depth, never the length.
  const ridge = plus(HEIGHT, times(depth, 0.42))
  const x0 = times(roofWidth, -0.5)
  const x1 = times(roofWidth, 0.5)
  const y0 = times(roofDepth, -0.5)
  const y1 = times(roofDepth, 0.5)
  return [
    box(ZERO, ZERO, SIDE, depth, ZERO, HEIGHT, WALL, ROOF),
    {
      centre: [ZERO, ZERO, plus(HEIGHT, times(depth, 0.42 * 0.3))],
      faces: [
        {
          paint: ROOF,
          points: [
            [x0, y0, HEIGHT],
            [x1, y0, HEIGHT],
            [x1, ZERO, ridge],
            [x0, ZERO, ridge],
          ],
        },
        {
          paint: ROOF,
          points: [
            [x1, y1, HEIGHT],
            [x0, y1, HEIGHT],
            [x0, ZERO, ridge],
            [x1, ZERO, ridge],
          ],
        },
        {
          paint: WALL,
          points: [
            [x1, y0, HEIGHT],
            [x1, y1, HEIGHT],
            [x1, ZERO, ridge],
          ],
        },
        {
          paint: WALL,
          points: [
            [x0, y1, HEIGHT],
            [x0, y0, HEIGHT],
            [x0, ZERO, ridge],
          ],
        },
      ],
    },
  ]
}

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

function pavilion(): Part[] {
  const floor = length(0.06)
  const eaves = length(1.5 * 0.5)
  const post = (x: number) =>
    square(
      plus(times(SIDE, x * 0.5), length(-x * 0.08)),
      plus(times(SIDE, 0.5), length(-0.08)),
      length(0.07),
      floor,
      eaves,
      POST,
      ROOF,
    )
  return [
    square(ZERO, ZERO, SIDE, ZERO, floor, FLOOR_SIDES, FLOOR_TOP),
    box(
      ZERO,
      plus(times(SIDE, -0.5), length(0.09)),
      plus(SIDE, length(-0.1)),
      length(0.18),
      floor,
      eaves,
      WALL,
      ROOF,
    ),
    post(-1),
    post(1),
    square(ZERO, ZERO, plus(SIDE, length(0.26)), eaves, plus(eaves, length(0.09)), ROOF_EDGE, ROOF),
  ]
}

const SHAPES: Record<Archetype, () => Part[]> = {
  pavilion,
  hall,
  house,
  smallBlock,
  setbackBlock,
  pyramidRoof,
  towerOnPodium,
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

const TYPICAL: Building = { archetype: 'smallBlock', side: 1.4, height: 3, split: 2 }

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

function vertex([x, y, z]: Point, normal: Vec3, paint: Paint): Corner {
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
  }
}

/** The archetype's triangles, each turned outwards. */
export function archetypeGeometry(archetype: Archetype): Triangle[] {
  const triangles: Triangle[] = []
  for (const part of SHAPES[archetype]()) {
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
      const apex = vertex(first, normal, face.paint)
      rest.forEach((point, i) => {
        const next = rest[i + 1]
        if (next) {
          // A fan from the apex: the far side is always outline, the sides from the apex only
          // for the first and last triangles.
          triangles.push(
            withEdges(
              [apex, vertex(point, normal, face.paint), vertex(next, normal, face.paint)],
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
