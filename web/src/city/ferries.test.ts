import { describe, expect, it } from 'vitest'
import { createFerries, miter } from './ferries'

describe('createFerries', () => {
  it('lays every line as one ribbon on the water, two edges per point, measured along', () => {
    const ferry = {
      a: 0,
      b: 1,
      imports: 10,
      upward: false,
      width: 0.8,
      path: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 },
      ],
    }
    const mesh = createFerries([ferry, { ...ferry, upward: true }])
    const { geometry } = mesh
    expect(geometry.getAttribute('position').count).toBe(2 * 2 * 3)
    expect(geometry.getIndex()?.count).toBe(2 * 2 * 6)
    expect(Array.from(geometry.getAttribute('along').array).slice(0, 6)).toEqual([
      0, 0, 10, 10, 15, 15,
    ])
    expect(geometry.getAttribute('halfWidth').getX(0)).toBeCloseTo(0.4)
  })
})

describe('miter', () => {
  it('widens to the left of the way, farther at a turn, never past twice', () => {
    expect(miter({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 })).toEqual([-0, 1, 1])
    const [nx, ny, scale] = miter({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 })
    expect(nx).toBeCloseTo(-Math.SQRT1_2)
    expect(ny).toBeCloseTo(Math.SQRT1_2)
    expect(scale).toBeCloseTo(Math.SQRT2)
    expect(miter({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0.1 })[2]).toBe(2)
  })
})
