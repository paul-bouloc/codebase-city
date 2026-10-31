// The city is measured in u: one floor is 0.5 u (about 3 m), one lot is 2 × 2 u.
export const FLOOR_HEIGHT = 0.5
export const LOT_SIZE = 2

export const MAX_LAYER = 5

/** Height of an island's plateau above the sea, from its layer (1 at the bottom, capped at 5). */
export function layerAltitude(layer: number): number {
  const clamped = Math.min(Math.max(Math.round(layer), 1), MAX_LAYER)
  return 1.2 + 1.8 * (clamped - 1)
}

export type Vec3 = [number, number, number]

/** Layouts put the ground on x, y with z up; three.js puts y up. */
export function boardToThree(x: number, y: number, z: number): Vec3 {
  return [x, z, -y]
}

/**
 * An sRGB colour as three channels in [0, 1], untouched by three.js colour management:
 * the city's shaders mix colours in sRGB, as the design does.
 */
export function srgb(hex: string): Vec3 {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match?.[1]) {
    throw new Error(`Not a #rrggbb colour: ${hex}`)
  }
  const value = Number.parseInt(match[1], 16)
  return [(value >> 16) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255]
}

// Mixes two `#rrggbb` colours in sRGB, as the art direction writes `mix(a, b, amount)`.
export function mixSrgb(a: string, b: string, amount: number): Vec3 {
  const from = srgb(a)
  const to = srgb(b)
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ]
}
