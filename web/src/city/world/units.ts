// The city is measured in u: one floor is 0.5 u (about 3 m), one lot is 2 × 2 u.
export const FLOOR_HEIGHT = 0.5
export const LOT_SIZE = 2

export const MAX_LAYER = 5

/** An island's layer, from 1 at the bottom to 5. */
export function clampLayer(layer: number): number {
  return Math.min(Math.max(Math.round(layer), 1), MAX_LAYER)
}

/**
 * Height of an island's plateau above the sea, from its layer: 0.6 u to 2.4 u, five floors at
 * most, low enough to read as land rather than as towers.
 */
export function layerAltitude(layer: number): number {
  return 0.6 + 0.45 * (clampLayer(layer) - 1)
}

/** How high a parcel's slab stands above the plateau: 0.15 u, then 0.1 u more on level 2. */
const SLAB_TOPS = [0.15, 0.25]
/**
 * Each deeper level stands a little higher still: nested slabs at one height would share their
 * top, and flicker where they overlap.
 */
const DEEPER_SLAB_STEP = 0.05
/** Past this level, slabs rise no more: a folder thousands deep would make a column of them. */
const HIGHEST_SLAB_LEVEL = 24

/** The top of the slab of a parcel `level` folders below its island, above the plateau, in u. */
export function slabTop(level: number): number {
  if (level <= 0) {
    return 0
  }
  const shallow = SLAB_TOPS[Math.min(level, SLAB_TOPS.length) - 1] ?? 0
  const deeper = Math.min(level, HIGHEST_SLAB_LEVEL) - SLAB_TOPS.length
  return shallow + Math.max(deeper, 0) * DEEPER_SLAB_STEP
}

export type Vec3 = [number, number, number]

/** Layouts put the ground on x, y with z up; three.js puts y up. */
export function boardToThree(x: number, y: number, z: number): Vec3 {
  return [x, z, -y]
}

/**
 * An sRGB colour as three channels in [0, 1], untouched by three.js colour management:
 * the city's shaders mix colours in sRGB.
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

/**
 * The camera's near plane, from its distance to its target: 2 % of it, from 0.5 u to 50 u.
 * Depth precision hangs on the near plane; fixed at 1 u, slabs 0.05 u apart fought for depth
 * once the camera stood a few hundred u away (vscode as a whole). Nothing stands that close to
 * a camera looking down on the city.
 */
export function nearPlane(distance: number): number {
  return Math.min(Math.max(distance * 0.02, 0.5), 50)
}
