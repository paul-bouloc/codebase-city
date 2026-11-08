import { describe, expect, it } from 'vitest'
import { pointAlong } from './links'
import { LANE, Route, SAIL_SPEED, sail } from './sailing'

// An L: 10 u east, then 10 u north.
const PATH = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
]
const route = new Route(PATH)

describe('Route', () => {
  it('measures the line and finds a point along it, with its heading', () => {
    expect(route.length).toBe(20)
    expect(route.at(5)).toEqual({ x: 5, y: 0, angle: 0 })
    const turn = route.at(15)
    expect(turn.x).toBe(10)
    expect(turn.y).toBe(5)
    expect(turn.angle).toBeCloseTo(Math.PI / 2)
    expect(route.at(-1)).toMatchObject({ x: 0, y: 0 })
    expect(route.at(25)).toMatchObject({ x: 10, y: 10 })
  })
})

// A straight line, 20 u east: a boat turns round 1.5 u short of each end.
const STRAIGHT = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
]
const straight = new Route(STRAIGHT)
const leg = (20 - 2 * 1.5) / SAIL_SPEED

describe('sail', () => {
  it('starts as far along as the boat stood still, beside the line', () => {
    for (const share of [0.25, 0.5, 2 / 3]) {
      const still = pointAlong(STRAIGHT, share).point
      const start = sail(straight, share, 0)
      expect(start.x).toBeCloseTo(still.x)
      expect(Math.abs(start.y)).toBeLessThanOrEqual(LANE)
    }
  })

  it('turns round short of the far pier, then comes back short of home', () => {
    const far = sail(straight, 0, leg)
    expect(far.x).toBeCloseTo(18.5)
    expect(far.y).toBeCloseTo(0)
    // Halfway through its turn there, then turned round.
    expect(far.angle).toBeCloseTo(Math.PI / 2)
    expect(sail(straight, 0, 1.2 * leg).angle).toBeCloseTo(Math.PI)
    const home = sail(straight, 0, 2 * leg)
    expect(home.x).toBeCloseTo(1.5)
    expect(home.y).toBeCloseTo(0)
    expect(sail(straight, 0, 2.2 * leg).angle).toBeCloseTo(0)
  })

  it('keeps to its right: two boats meeting halfway pass each other', () => {
    const going = sail(straight, 0, 0.5 * leg)
    const coming = sail(straight, 0, 1.5 * leg)
    expect(going.x).toBeCloseTo(10)
    expect(coming.x).toBeCloseTo(10)
    expect(going.y).toBeCloseTo(-LANE)
    expect(coming.y).toBeCloseTo(LANE)
  })

  it('goes slowly near a pier and fast halfway', () => {
    const step = leg / 100
    const travelled = (from: number) => {
      const a = sail(straight, 0, from)
      const b = sail(straight, 0, from + step)
      return Math.hypot(b.x - a.x, b.y - a.y)
    }
    expect(travelled(0)).toBeLessThan(travelled(leg / 2 - step / 2) / 10)
  })

  it('stays in the middle of a line too short to sail', () => {
    const short = new Route([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ])
    expect(sail(short, 0.2, 10)).toMatchObject({ x: 1, y: 0 })
  })
})
