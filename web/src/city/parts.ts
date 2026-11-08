import { mixSrgb, srgb, type Vec3 } from './world/units'

// The pieces buildings are made of. A vertex coordinate is a length
// `fixed + side × s + height × h + split × k`, where s, h and k come from the instance: what
// should stretch follows the instance, what should not (kiosks, antennas, roof pitches, teeth)
// keeps its size in u. The vertex shader adds the parts up.

/** [fixed, side, height, split] coefficients, in u. */
export type Length = readonly [number, number, number, number]
/** Board coordinates: x, y on the ground, z up. */
export type Point = readonly [Length, Length, Length]

export const length = (fixed: number, side = 0, height = 0, split = 0): Length => [
  fixed,
  side,
  height,
  split,
]
export const plus = (a: Length, b: Length): Length => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
  a[3] + b[3],
]
export const times = (a: Length, factor: number): Length => [
  a[0] * factor,
  a[1] * factor,
  a[2] * factor,
  a[3] * factor,
]
export const minus = (a: Length, b: Length): Length => plus(a, times(b, -1))
/** Halfway between `a` and `b`. */
export const middle = (a: Length, b: Length): Length => times(plus(a, b), 0.5)
export const ZERO = length(0)
export const SIDE = length(0, 1)
export const HEIGHT = length(0, 0, 1)
export const SPLIT = length(0, 0, 0, 1)

/** A face's colour: `mix(language, colour, amount)`, in sRGB. */
export interface Paint {
  colour: Vec3
  amount: number
}

export const WHITE = srgb('#FFFFFF')
export const WALL: Paint = { colour: WHITE, amount: 0.58 }
export const ROOF: Paint = { colour: WHITE, amount: 0 }
export const TRIM: Paint = { colour: WHITE, amount: 0.35 }
export const fixedPaint = (colour: Vec3): Paint => ({ colour, amount: 1 })

/** `mix(paint, colour, amount)`: still a mix of the language with one colour. */
export function toward({ colour, amount }: Paint, hex: string, share: number): Paint {
  const target = srgb(hex)
  const mixed = 1 - (1 - share) * (1 - amount)
  const blend = (base: number, other: number) =>
    mixed === 0 ? 0 : ((1 - share) * amount * base + share * other) / mixed
  return {
    colour: [blend(colour[0], target[0]), blend(colour[1], target[1]), blend(colour[2], target[2])],
    amount: mixed,
  }
}

export const INK = fixedPaint(srgb('#23313A'))
export const WOOD = '#B98B5E'
export const FLOOR_SIDES = fixedPaint(mixSrgb(WOOD, '#000000', 0.15))
export const FLOOR_TOP = fixedPaint(mixSrgb(WOOD, '#FFFFFF', 0.2))
export const POST = fixedPaint(mixSrgb(WOOD, '#000000', 0.2))
export const ROOF_EDGE = fixedPaint(mixSrgb(WOOD, '#000000', 0.1))
// Concrete takes the instance's tint, a shade of concrete; its roof is a little darker.
export const CONCRETE_WALL: Paint = { colour: WHITE, amount: 0 }
export const CONCRETE_ROOF: Paint = { colour: srgb('#000000'), amount: 0.045 }

export interface Face {
  points: Point[]
  paint: Paint
  /** The face a generated file's three bars are stamped on. */
  stamp?: boolean
  /** Where its bars are centred, on the board; the middle of its corners if absent. */
  stampCentre?: readonly [Length, Length]
}

/** Faces that close around `centre`: it tells their outside. */
export interface Part {
  faces: Face[]
  centre: Point
}

/** Faces around the average of their corners. */
export function part(faces: Face[]): Part {
  const points = faces.flatMap((face) => face.points)
  const average = (axis: 0 | 1 | 2) =>
    times(
      points.reduce((sum, point) => plus(sum, point[axis]), ZERO),
      1 / points.length,
    )
  return { faces, centre: [average(0), average(1), average(2)] }
}

/**
 * The straight line through `f` at two sides: a length the design defines by a ratio of sides,
 * close enough between them, and exact at both.
 */
export function fitSide(f: (side: number) => number, from: number, to: number): Length {
  const slope = (f(to) - f(from)) / (to - from)
  return length(f(from) - slope * from, slope)
}

type Side = 'top' | 'x-' | 'x+' | 'y-' | 'y+'

/** A height that may differ at the two ends, along y: a sloping top or bottom. */
export type Level = Length | readonly [atY0: Length, atY1: Length]

/**
 * A box without a bottom from its corners, as the design draws them: its bottom and top may
 * slope along y, and any face may be left out where it meets another part.
 */
export function cuboid(
  [x0, y0, x1, y1]: readonly [Length, Length, Length, Length],
  bottom: Level,
  top: Level,
  wall: Paint,
  roof: Paint,
  {
    omit = [],
    stamp = false,
    stampCentre,
  }: { omit?: readonly Side[]; stamp?: boolean; stampCentre?: readonly [Length, Length] } = {},
): Part {
  const ends = (level: Level): readonly [Length, Length] =>
    level.length === 2 ? level : [level, level]
  const [b0, b1] = ends(bottom)
  const [a0, a1] = ends(top)
  const faces: Record<Side, Face> = {
    top: {
      paint: roof,
      stamp,
      ...(stampCentre ? { stampCentre } : {}),
      points: [
        [x0, y0, a0],
        [x1, y0, a0],
        [x1, y1, a1],
        [x0, y1, a1],
      ],
    },
    'x+': {
      paint: wall,
      points: [
        [x1, y0, b0],
        [x1, y1, b1],
        [x1, y1, a1],
        [x1, y0, a0],
      ],
    },
    'x-': {
      paint: wall,
      points: [
        [x0, y1, b1],
        [x0, y0, b0],
        [x0, y0, a0],
        [x0, y1, a1],
      ],
    },
    'y+': {
      paint: wall,
      points: [
        [x1, y1, b1],
        [x0, y1, b1],
        [x0, y1, a1],
        [x1, y1, a1],
      ],
    },
    'y-': {
      paint: wall,
      points: [
        [x0, y0, b0],
        [x1, y0, b0],
        [x1, y0, a0],
        [x0, y0, a0],
      ],
    },
  }
  const kept = (Object.keys(faces) as Side[]).filter((side) => !omit.includes(side))
  const corners = [x0, x1].flatMap((x) =>
    [
      [y0, b0, a0],
      [y1, b1, a1],
    ].flatMap(([y, b, a]) => [[x, y, b] as Point, [x, y, a] as Point]),
  )
  const average = (axis: 0 | 1 | 2) =>
    times(
      corners.reduce((sum, point) => plus(sum, point[axis]), ZERO),
      1 / corners.length,
    )
  return {
    faces: kept.map((side) => faces[side]),
    centre: [average(0), average(1), average(2)],
  }
}

/** A box without a bottom, centred on (x, y), from z0 to z1. */
export function box(
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
export const square = (
  x: Length,
  y: Length,
  size: Length,
  z0: Length,
  z1: Length,
  wall: Paint,
  roof: Paint,
) => box(x, y, size, size, z0, z1, wall, roof)
