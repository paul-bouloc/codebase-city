import { boardToThree, type Vec3 } from '../world/units'

function normalize([x, y, z]: Vec3): Vec3 {
  const length = Math.hypot(x, y, z)
  return [x / length, y / length, z / length]
}

/** Towards the sun, in three.js coordinates. The sun never moves, even in the top view. */
export const SUN_DIRECTION: Vec3 = normalize(boardToThree(-0.35, 0.75, 1))

// k = (AMBIENT + DIFFUSE × max(0, n·L)) / NORMALIZER: a flat roof shows its exact colour.
export const AMBIENT = 0.7
export const DIFFUSE = 0.3
export const NORMALIZER = 0.93

/**
 * How much a face's colour is scaled, from the cosine between its normal and the sun. The
 * reference copy of `shade()` in shading.ts, for tests and figures: change both together.
 */
export function lightFactor(nDotL: number): number {
  return (AMBIENT + DIFFUSE * Math.max(0, nDotL)) / NORMALIZER
}

export const SHADOW_COLOR = '#4A3220'
export const SHADOW_OPACITY = 0.16
