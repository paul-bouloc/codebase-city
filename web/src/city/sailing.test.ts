import { describe, expect, it } from 'vitest'
import { pointAlong } from './links'
import { Route, SAIL_SPEED, sail } from './sailing'

// An L: 10 u east, then 10 u north.
const PATH = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
]
const route = new Route(PATH)
const leg = route.length / SAIL_SPEED

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

describe('sail', () => {
  it('starts where the boat stood still', () => {
    for (const share of [0.25, 0.5, 2 / 3]) {
      const still = pointAlong(PATH, share).point
      const start = sail(route, share, 0)
      expect(start.x).toBeCloseTo(still.x)
      expect(start.y).toBeCloseTo(still.y)
    }
  })

  it('reaches the far pier after a leg, then comes back, turned round', () => {
    const end = sail(route, 0, leg)
    expect(end.x).toBeCloseTo(10)
    expect(end.y).toBeCloseTo(10)
    const back = sail(route, 0, 1.5 * leg)
    expect(back.x).toBeCloseTo(10)
    expect(back.y).toBeCloseTo(0)
    expect(back.angle).toBeCloseTo(0 + Math.PI)
    const home = sail(route, 0, 2 * leg)
    expect(home.x).toBeCloseTo(0)
    expect(home.y).toBeCloseTo(0)
  })

  it('goes slowly near a pier and fast halfway', () => {
    const step = leg / 100
    const travelled = (from: number) => {
      const a = sail(route, 0, from)
      const b = sail(route, 0, from + step)
      return Math.hypot(b.x - a.x, b.y - a.y)
    }
    expect(travelled(0)).toBeLessThan(travelled(leg / 2 - step / 2) / 10)
  })

  it('stays on a line too short to sail', () => {
    expect(sail(new Route([{ x: 3, y: 4 }]), 0.5, 10)).toMatchObject({ x: 3, y: 4 })
  })
})
