import { describe, expect, it } from 'vitest'
import { boundsOf, distanceToRect, type Rect } from './layout'
import { channelWidth, syntheticCity } from './synthetic'

/** Shortest distance between two disjoint rectangles. */
function gapBetween(a: Rect, b: Rect): number {
  const dx = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), 0)
  const dy = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height), 0)
  return Math.hypot(dx, dy)
}

describe('channelWidth', () => {
  it('keeps channels between 9 and 24 u', () => {
    expect(channelWidth(20)).toBe(9)
    expect(channelWidth(80)).toBeCloseTo(17.6)
    expect(channelWidth(150)).toBe(24)
  })
})

describe('syntheticCity', () => {
  const city = syntheticCity({ islands: 12, files: 2_000 })

  it('is the same city for the same seed', () => {
    expect(syntheticCity({ islands: 12, files: 2_000 })).toEqual(city)
    expect(syntheticCity({ islands: 12, files: 2_000, seed: 'other' })).not.toEqual(city)
  })

  it('gives every file one lot', () => {
    expect(city.islands).toHaveLength(12)
    expect(city.islands.reduce((sum, island) => sum + island.lots.length, 0)).toBe(2_000)
    expect(city.islands.every((island) => island.lots.length >= 1)).toBe(true)
  })

  it('keeps plateaux at least 10 × 6.6 u, on layers 1 to 5', () => {
    for (const { plateau, layer } of city.islands) {
      expect(plateau.width).toBeGreaterThanOrEqual(10)
      expect(plateau.height).toBeGreaterThanOrEqual(6.6)
      expect([1, 2, 3, 4, 5]).toContain(layer)
    }
  })

  it('puts each whole lot on its plateau', () => {
    for (const { plateau, lots } of city.islands) {
      for (const lot of lots) {
        expect(lot.x - 1).toBeGreaterThanOrEqual(plateau.x)
        expect(lot.y - 1).toBeGreaterThanOrEqual(plateau.y)
        expect(lot.x + 1).toBeLessThanOrEqual(plateau.x + plateau.width + 1e-9)
        expect(lot.y + 1).toBeLessThanOrEqual(plateau.y + plateau.height + 1e-9)
        expect(distanceToRect(lot.x, lot.y, plateau)).toBe(0)
      }
    }
  })

  it('separates every pair of plateaux by a channel of at least 9 u', () => {
    const plateaux = city.islands.map((island) => island.plateau)
    plateaux.forEach((a, i) => {
      for (const b of plateaux.slice(i + 1)) {
        expect(gapBetween(a, b)).toBeGreaterThanOrEqual(9 - 1e-9)
      }
    })
  })

  it('centres the city on the origin', () => {
    const { bounds } = city
    expect(bounds).toEqual(boundsOf(city.islands.map((island) => island.plateau)))
    expect(bounds.x + bounds.width / 2).toBeCloseTo(0)
    expect(bounds.y + bounds.height / 2).toBeCloseTo(0)
  })

  it('handles a single tiny island', () => {
    const tiny = syntheticCity({ islands: 1, files: 1 })
    expect(tiny.islands[0]?.lots).toHaveLength(1)
    expect(tiny.bounds.width).toBeGreaterThanOrEqual(10)
  })

  it('rejects impossible requests', () => {
    expect(() => syntheticCity({ islands: 0, files: 10 })).toThrow(RangeError)
    expect(() => syntheticCity({ islands: 5, files: 3 })).toThrow(RangeError)
  })
})
