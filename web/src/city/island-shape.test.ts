import { describe, expect, it } from 'vitest'
import {
  BEACH_ALTITUDE,
  type ContourSample,
  FOAM_WIDTH,
  type IslandShape,
  islandShape,
  islandShapes,
  ringAltitudes,
} from './island-shape'
import { type CityLayout, distanceToRect, type IslandLayout, type Rect } from './layout'
import { syntheticCity } from './synthetic'
import { layerAltitude } from './units'

function island(path: string, plateau: Rect, layer = 1): IslandLayout {
  return { path, layer, plateau, parcels: [], lots: [] }
}

/** Where a ring passes at a sample. */
function ringPoint(sample: ContourSample, ring: number): [number, number] {
  const offset = sample.offsets[ring] ?? 0
  return [sample.x + sample.nx * offset, sample.y + sample.ny * offset]
}

function beach(shape: IslandShape): [number, number][] {
  return shape.samples.map((sample) => ringPoint(sample, shape.altitudes.length - 1))
}

function distanceToSegment(
  [px, py]: [number, number],
  [ax, ay]: [number, number],
  [bx, by]: [number, number],
): number {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(Math.max(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0), 1)
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** The shortest distance between two closed outlines. */
function gapBetween(a: [number, number][], b: [number, number][]): number {
  let gap = Number.POSITIVE_INFINITY
  for (const [first, second] of [
    [a, b],
    [b, a],
  ] as const) {
    for (const point of first) {
      second.forEach((start, index) => {
        const end = second[(index + 1) % second.length] ?? start
        gap = Math.min(gap, distanceToSegment(point, start, end))
      })
    }
  }
  return gap
}

describe('ringAltitudes', () => {
  it('steps down from the plateau to the beach, more terraces on higher layers', () => {
    expect([1, 2, 3, 4, 5].map((layer) => ringAltitudes(layer).length - 1)).toEqual([1, 2, 4, 5, 6])
    for (const layer of [1, 3, 5]) {
      const altitudes = ringAltitudes(layer)
      expect(altitudes[0]).toBe(layerAltitude(layer))
      expect(altitudes.at(-1)).toBeCloseTo(BEACH_ALTITUDE)
      altitudes.slice(1).forEach((altitude, index) => {
        expect(altitude).toBeLessThan(altitudes[index] ?? 0)
      })
    }
  })
})

describe('islandShape', () => {
  const plateau = { x: 0, y: 0, width: 30, height: 14 }
  const alone = islandShape(island('alone', plateau, 5), [])

  it('keeps the plateau edge outside the rectangle: no lot falls', () => {
    for (const sample of alone.samples) {
      const [x, y] = ringPoint(sample, 0)
      expect(distanceToRect(x, y, plateau)).toBeGreaterThanOrEqual(0.85 - 1e-9)
    }
  })

  it('never lets two rings cross', () => {
    for (const sample of alone.samples) {
      sample.offsets.slice(1).forEach((offset, index) => {
        expect(offset).toBeGreaterThan(sample.offsets[index] ?? 0)
      })
    }
  })

  it('goes around the plateau counter-clockwise, rounding its corners', () => {
    // 14 steps along 30 u, 6 along 14 u, both ends included, and six samples in each corner
    expect(alone.samples).toHaveLength(2 * 15 + 2 * 7 + 4 * 6)
    const areas = alone.samples.map((sample, index) => {
      const next = alone.samples[(index + 1) % alone.samples.length] ?? sample
      const [ax, ay] = ringPoint(sample, 0)
      const [bx, by] = ringPoint(next, 0)
      return ax * by - bx * ay
    })
    expect(areas.reduce((sum, area) => sum + area, 0)).toBeGreaterThan(0)
  })

  it('opens wide terraces to the open sea', () => {
    const beachOffsets = alone.samples.map((sample) => sample.offsets.at(-1) ?? 0)
    // Six terraces of 1.3 u, past the plateau's 0.85 u
    expect(Math.min(...beachOffsets)).toBeGreaterThanOrEqual(0.85 + 6 * 1.3 - 1e-9)
    expect(alone.reach).toBe(Math.max(...beachOffsets))
  })

  it('gives the same terrain to the same island', () => {
    const again = islandShape(island('alone', plateau, 5), [])
    expect(again.samples).toEqual(alone.samples)
    const other = islandShape(island('other', plateau, 5), [])
    expect(other.samples).not.toEqual(alone.samples)
  })

  it('reads the rings anywhere along a side, as its samples do', () => {
    const south = alone.samples[3]
    expect(south?.y).toBe(0)
    expect(alone.offsetsAt('south', south?.x ?? 0)).toEqual(south?.offsets)
  })
})

describe('islandShapes', () => {
  it('keeps the foams of two high islands apart across the narrowest channel', () => {
    const layout: CityLayout = {
      islands: [
        island('west', { x: 0, y: 0, width: 30, height: 20 }, 5),
        island('east', { x: 39, y: -6, width: 30, height: 20 }, 5),
      ],
      bounds: { x: 0, y: -6, width: 69, height: 26 },
    }
    const [west, east] = islandShapes(layout)
    if (!west || !east) {
      throw new Error('two shapes expected')
    }
    expect(gapBetween(beach(west), beach(east))).toBeGreaterThanOrEqual(2 * FOAM_WIDTH)
    // Facing each other, the terraces narrow; on the open sea, they stay wide
    const westEast = west.offsetsAt('east', 10).at(-1) ?? 0
    const westWest = west.offsetsAt('west', 10).at(-1) ?? 0
    expect(westEast).toBeLessThan(4.5)
    expect(westWest).toBeGreaterThan(8)
  })

  it('keeps every pair of beaches apart in a packed city', () => {
    const shapes = islandShapes(syntheticCity({ islands: 12, files: 900, seed: 'beaches' }))
    for (let a = 0; a < shapes.length; a++) {
      for (let b = a + 1; b < shapes.length; b++) {
        const first = shapes[a]
        const second = shapes[b]
        if (first && second) {
          expect(gapBetween(beach(first), beach(second))).toBeGreaterThanOrEqual(2 * FOAM_WIDTH)
        }
      }
    }
  })
})
