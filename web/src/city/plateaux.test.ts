import { describe, expect, it } from 'vitest'
import type { CityLayout } from './layout'
import { createParcels, roundedOutline } from './plateaux'

/** Whether a point is inside a convex counter-clockwise outline. */
function inside(outline: [number, number][], [px, py]: [number, number]): boolean {
  return outline.every(([ax, ay], index) => {
    const [bx, by] = outline[(index + 1) % outline.length] ?? [ax, ay]
    return (bx - ax) * (py - ay) - (by - ay) * (px - ax) >= -1e-9
  })
}

describe('roundedOutline', () => {
  const parcel = { x: 10, y: 20, width: 8.6, height: 4.6 }
  const outline = roundedOutline(parcel)

  it('rounds each corner inside the rectangle, counter-clockwise', () => {
    expect(outline).toHaveLength(12)
    for (const [x, y] of outline) {
      expect(x).toBeGreaterThanOrEqual(parcel.x - 1e-9)
      expect(x).toBeLessThanOrEqual(parcel.x + parcel.width + 1e-9)
      expect(y).toBeGreaterThanOrEqual(parcel.y - 1e-9)
      expect(y).toBeLessThanOrEqual(parcel.y + parcel.height + 1e-9)
    }
    expect(inside(outline, [parcel.x + 4, parcel.y + 2])).toBe(true)
    expect(inside(outline, [parcel.x + 0.05, parcel.y + 0.05])).toBe(false)
  })

  it('never cuts a building on a corner lot', () => {
    // The corner lot's centre is 0.3 + 1 u in; a building, turned and shifted, stays within
    // 0.9 u of it, roof included
    const centre: [number, number] = [parcel.x + 1.3, parcel.y + 1.3]
    for (let step = 0; step < 32; step++) {
      const angle = (step / 32) * Math.PI * 2
      const point: [number, number] = [
        centre[0] + 0.9 * Math.cos(angle),
        centre[1] + 0.9 * Math.sin(angle),
      ]
      expect(inside(outline, point)).toBe(true)
    }
  })

  it('keeps a narrow parcel whole', () => {
    const narrow = roundedOutline({ x: 0, y: 0, width: 1, height: 6 })
    for (const [x] of narrow) {
      expect(x).toBeGreaterThanOrEqual(-1e-9)
      expect(x).toBeLessThanOrEqual(1 + 1e-9)
    }
  })
})

describe('createParcels', () => {
  it('draws a folder of the island square, the ones inside rounded, each on its parent', () => {
    const layout: CityLayout = {
      islands: [
        {
          path: 'island',
          layer: 1,
          plateau: { x: 0, y: 0, width: 12, height: 8 },
          parcels: [
            { rect: { x: 0.9, y: 0.9, width: 10.2, height: 6.2 }, level: 1, nature: 'normal' },
            // Flush with its parent's west edge
            { rect: { x: 0.9, y: 1.2, width: 4, height: 4 }, level: 2, nature: 'normal' },
          ],
          lots: [],
        },
      ],
      bounds: { x: 0, y: 0, width: 12, height: 8 },
    }
    const position = createParcels(layout).geometry.getAttribute('position')
    // A square slab in 4 + 8 triangles, a rounded one in 12 + 24
    expect(position.count / 3).toBe(12 + 36)
    // The nested slab's sides start on its parent's top (0.6 + 0.15), never on the plateau
    const nested = Array.from({ length: position.count - 36 }, (_, index) =>
      position.getY(36 + index),
    )
    expect(Math.min(...nested)).toBeCloseTo(0.75)
    const outer = Array.from({ length: 36 }, (_, index) => position.getY(index))
    expect(Math.min(...outer)).toBeCloseTo(0.6)
  })

  it('lays a slab under an island square that is not ordinary code', () => {
    const square = { x: 0.9, y: 0.9, width: 4.6, height: 4.6 }
    const layout = (nature: 'normal' | 'tests'): CityLayout => ({
      islands: [
        {
          path: 'island',
          layer: 1,
          plateau: { x: 0, y: 0, width: 10, height: 6.6 },
          parcels: [],
          lots: [],
          square,
          grids: [{ rect: square, nature, base: 0, square: true }],
        },
      ],
      bounds: { x: 0, y: 0, width: 10, height: 6.6 },
    })
    const triangles = (city: CityLayout) =>
      createParcels(city).geometry.getAttribute('position').count / 3
    expect(triangles(layout('normal'))).toBe(0)
    expect(triangles(layout('tests'))).toBe(12)
  })
})
