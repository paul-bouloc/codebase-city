import { describe, expect, it } from 'vitest'
import { type CityLayout, distanceToRect } from './layout'
import { SEA_FIELD_RANGE, type SeaField, seaField } from './sea-field'
import { syntheticCity } from './synthetic'

const square: CityLayout = {
  islands: [
    {
      path: 'a',
      layer: 1,
      plateau: { x: -5, y: -5, width: 10, height: 10 },
      parcels: [],
      lots: [],
    },
  ],
  bounds: { x: -5, y: -5, width: 10, height: 10 },
}

/** The stored distance at a board point, in u. */
function sample(field: SeaField, x: number, y: number): number {
  const column = Math.floor((x - field.originX) / field.texel)
  const row = Math.floor((y - field.originY) / field.texel)
  const value = field.data[row * field.columns + column]
  if (value === undefined) {
    throw new Error(`(${x}, ${y}) is outside the field`)
  }
  return (value / 255) * SEA_FIELD_RANGE
}

describe('seaField', () => {
  const field = seaField(square)

  it('covers the city and the outermost band around it', () => {
    expect(field.originX).toBeLessThanOrEqual(-5 - SEA_FIELD_RANGE)
    expect(field.originX + field.columns * field.texel).toBeGreaterThanOrEqual(5 + SEA_FIELD_RANGE)
    expect(field.data).toHaveLength(field.columns * field.rows)
  })

  it('is zero on the plateau and grows away from it', () => {
    expect(sample(field, 0, 0)).toBe(0)
    expect(sample(field, 15, 0)).toBeGreaterThan(sample(field, 8, 0))
    expect(sample(field, 30, 0)).toBeGreaterThan(sample(field, 15, 0))
  })

  it('wobbles by 3 u at most', () => {
    for (const distance of [5, 12, 20, 35]) {
      const x = 5 + distance + 0.5
      expect(Math.abs(sample(field, x, 0.5) - (distance + 0.5))).toBeLessThanOrEqual(3 + 0.5)
    }
  })

  it('saturates far from the city', () => {
    const corner = field.data[0]
    expect(corner).toBe(255)
  })

  it('keeps big cities within the texel budget', () => {
    const big = seaField(syntheticCity({ islands: 30, files: 60_000 }), 256)
    expect(big.columns).toBeLessThanOrEqual(256)
    expect(big.rows).toBeLessThanOrEqual(256)
    expect(big.texel).toBeGreaterThan(1)
  })

  it('matches the nearest plateau computed texel by texel', () => {
    const city = syntheticCity({ islands: 9, files: 900 })
    const sparse = seaField(city, 128)
    for (let row = 0; row < sparse.rows; row += 3) {
      for (let column = 0; column < sparse.columns; column += 3) {
        const x = sparse.originX + (column + 0.5) * sparse.texel
        const y = sparse.originY + (row + 0.5) * sparse.texel
        const nearest = Math.min(
          ...city.islands.map((island) => distanceToRect(x, y, island.plateau)),
        )
        const stored = ((sparse.data[row * sparse.columns + column] ?? 0) / 255) * SEA_FIELD_RANGE
        if (nearest > SEA_FIELD_RANGE + 3) {
          expect(stored).toBe(SEA_FIELD_RANGE)
        } else {
          expect(Math.abs(stored - nearest)).toBeLessThanOrEqual(3 + 0.2)
        }
      }
    }
  })

  it('is the same for the same city', () => {
    expect(seaField(square)).toEqual(field)
  })
})
