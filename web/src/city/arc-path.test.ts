import { describe, expect, it } from 'vitest'
import { ARC_SEGMENTS, arcPoints, arcRise } from './arc-path'

describe('arcRise', () => {
  it('rises higher the further apart the ends are, up to 30 u', () => {
    expect(arcRise([0, 0, 0], [0, 5, 0])).toBe(2)
    expect(arcRise([0, 0, 0], [30, 0, 40])).toBeCloseTo(2 + 0.28 * 50)
    expect(arcRise([0, 0, 0], [1000, 0, 0])).toBe(30)
  })
})

describe('arcPoints', () => {
  it('goes from roof to roof through its peak, above the higher roof', () => {
    const points = arcPoints([0, 1, 0], [20, 3, 0])
    expect(points).toHaveLength(ARC_SEGMENTS + 1)
    expect(points[0]).toEqual([0, 1, 0])
    const last = points.at(-1) ?? []
    expect(last[0]).toBeCloseTo(20)
    expect(last[1]).toBeCloseTo(3)
    const middle = points[ARC_SEGMENTS / 2] ?? []
    expect(middle[0]).toBeCloseTo(10)
    expect(middle[1]).toBeCloseTo(3 + 2 + 0.28 * 20)
    // Nowhere does it dip below the lower roof
    expect(Math.min(...points.map((point) => point[1]))).toBe(1)
  })
})

describe('arcPoints, raised', () => {
  it('rises higher by its share, in the same vertical plane', () => {
    const raised = arcPoints([0, 0, 0], [20, 0, 0], ARC_SEGMENTS, 1.5)
    const middle = raised[ARC_SEGMENTS / 2] ?? []
    expect(middle[1]).toBeCloseTo(1.5 * (2 + 0.28 * 20))
    expect(raised.every((point) => point[2] === 0)).toBe(true)
  })
})
