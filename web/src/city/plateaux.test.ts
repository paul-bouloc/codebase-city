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
  it('draws a slab in 36 triangles', () => {
    const layout: CityLayout = {
      islands: [
        {
          path: 'island',
          layer: 1,
          plateau: { x: 0, y: 0, width: 12, height: 8 },
          parcels: [
            { rect: { x: 0.9, y: 0.9, width: 10.2, height: 6.2 }, level: 1, nature: 'normal' },
          ],
          lots: [],
        },
      ],
      bounds: { x: 0, y: 0, width: 12, height: 8 },
    }
    const mesh = createParcels(layout)
    expect(mesh.geometry.getAttribute('position').count / 3).toBe(36)
  })
})
