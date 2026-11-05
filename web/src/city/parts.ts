import { mixSrgb, srgb, type Vec3 } from './units'

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
}

/** Faces that close around `centre`: it tells their outside. */
export interface Part {
  faces: Face[]
  centre: Point
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
