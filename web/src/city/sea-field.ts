import { type CityLayout, distanceToRect } from './layout'
import { seededRandom } from './random'

/** Outer edges of the five depth bands, in u from the archipelago. */
export const DEPTH_BANDS = [8, 15, 23, 31, 40] as const
const BAND_NOISE = 3

/** Distances are stored up to here: past the last band and its noise, the sea is flat. */
export const SEA_FIELD_RANGE = 48

/**
 * Distance to the nearest plateau, plus a smooth ±3 u wobble, sampled on a grid around the
 * city once per city: the sea shader reads its depth bands from it.
 */
export interface SeaField {
  /** Row-major, one byte per texel: 0 is the shore, 255 is SEA_FIELD_RANGE or more. */
  data: Uint8Array
  columns: number
  rows: number
  /** Board coordinates of the first texel's corner. */
  originX: number
  originY: number
  /** Texel size, in u. */
  texel: number
}

export function seaField(layout: CityLayout, maxTexels = 512): SeaField {
  const margin = SEA_FIELD_RANGE + BAND_NOISE
  const width = layout.bounds.width + 2 * margin
  const height = layout.bounds.height + 2 * margin
  const texel = Math.max(1, Math.max(width, height) / maxTexels)
  const columns = Math.ceil(width / texel)
  const rows = Math.ceil(height / texel)
  const originX = layout.bounds.x - margin
  const originY = layout.bounds.y - margin
  const wobble = noise2d('sea')
  const plateaux = layout.islands.map((island) => island.plateau)

  // Each plateau only reaches the texels within `margin` of it: further out, the field saturates.
  const distances = new Float32Array(columns * rows).fill(Number.POSITIVE_INFINITY)
  for (const plateau of plateaux) {
    const firstColumn = Math.max(0, Math.floor((plateau.x - margin - originX) / texel))
    const lastColumn = Math.min(
      columns - 1,
      Math.ceil((plateau.x + plateau.width + margin - originX) / texel),
    )
    const firstRow = Math.max(0, Math.floor((plateau.y - margin - originY) / texel))
    const lastRow = Math.min(
      rows - 1,
      Math.ceil((plateau.y + plateau.height + margin - originY) / texel),
    )
    for (let row = firstRow; row <= lastRow; row++) {
      const y = originY + (row + 0.5) * texel
      for (let column = firstColumn; column <= lastColumn; column++) {
        const x = originX + (column + 0.5) * texel
        const index = row * columns + column
        distances[index] = Math.min(distances[index] ?? 0, distanceToRect(x, y, plateau))
      }
    }
  }

  const data = new Uint8Array(columns * rows).fill(255)
  for (let row = 0; row < rows; row++) {
    const y = originY + (row + 0.5) * texel
    for (let column = 0; column < columns; column++) {
      const index = row * columns + column
      const distance = distances[index] ?? Number.POSITIVE_INFINITY
      if (distance >= margin) {
        continue
      }
      const x = originX + (column + 0.5) * texel
      // No wobble on the shore itself: the first band always starts at the plateau.
      const wobbled = distance + BAND_NOISE * wobble(x, y) * Math.min(distance / BAND_NOISE, 1)
      const clamped = Math.min(Math.max(wobbled, 0), SEA_FIELD_RANGE)
      data[index] = Math.round((clamped / SEA_FIELD_RANGE) * 255)
    }
  }
  return { data, columns, rows, originX, originY, texel }
}

/** Smooth noise in [-1, 1] with a wavelength of a few dozen u: a sum of seeded plane waves. */
function noise2d(seed: string): (x: number, y: number) => number {
  const random = seededRandom(seed)
  const waves = [
    { wavelength: 41, weight: 0.5 },
    { wavelength: 23, weight: 0.3 },
    { wavelength: 13, weight: 0.2 },
  ].map(({ wavelength, weight }) => {
    const angle = random() * Math.PI * 2
    const k = (Math.PI * 2) / wavelength
    return {
      kx: Math.cos(angle) * k,
      ky: Math.sin(angle) * k,
      phase: random() * Math.PI * 2,
      weight,
    }
  })
  return (x, y) => {
    let sum = 0
    for (const wave of waves) {
      sum += wave.weight * Math.sin(wave.kx * x + wave.ky * y + wave.phase)
    }
    return sum
  }
}
