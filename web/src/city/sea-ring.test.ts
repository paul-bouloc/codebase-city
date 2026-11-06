import { describe, expect, it } from 'vitest'
import { arcLength, arcPasses, ring, ringArc, ringParam, ringPoint, sideMiddle } from './sea-ring'

describe('ring', () => {
  const around = ring({ x: 0, y: 0, width: 40, height: 20 }, 5)

  it('measures its sides and rounded corners', () => {
    expect(around.length).toBeCloseTo(2 * 30 + 2 * 10 + 2 * Math.PI * 5)
    expect(ringPoint(around, 0)).toEqual({ x: 5, y: 0 })
    expect(ringPoint(around, 30).x).toBeCloseTo(35)
    // Halfway round its south-east corner
    const corner = ringPoint(around, 30 + (Math.PI / 4) * 5)
    expect(Math.hypot(corner.x - 35, corner.y - 5)).toBeCloseTo(5)
    expect(ringPoint(around, around.length + 1)).toEqual(ringPoint(around, 1))
  })

  it('finds the nearest point of a point outside', () => {
    expect(ringParam(around, { x: 20, y: -9 })).toBeCloseTo(15, 1)
    const west = sideMiddle(around, 'west')
    expect(ringPoint(around, west).x).toBeCloseTo(0)
    expect(ringPoint(around, west).y).toBeCloseTo(10)
    expect(ringPoint(around, sideMiddle(around, 'east')).x).toBeCloseTo(40)
  })

  it('goes either way round, and knows what it passes', () => {
    const west = sideMiddle(around, 'west')
    const east = sideMiddle(around, 'east')
    // From the south side to the north side, by the east or by the west
    const south = 15
    const north = ringParam(around, { x: 20, y: 30 })
    expect(arcPasses(around, south, north, true, east)).toBe(true)
    expect(arcPasses(around, south, north, false, west)).toBe(true)
    expect(arcPasses(around, south, north, true, west)).toBe(false)
    expect(
      arcLength(around, south, north, true) + arcLength(around, south, north, false),
    ).toBeCloseTo(around.length)
    const arc = ringArc(around, south, north, false, 2)
    expect(arc[0]).toEqual(ringPoint(around, south))
    expect(Math.min(...arc.map((point) => point.x))).toBeCloseTo(0)
  })
})
