import { describe, expect, it } from 'vitest'
import { islandShapes } from './island-shape'
import { boundsOf, type CityLayout, type Point, type Rect } from './layout'
import {
  insidePolygon,
  landOutline,
  onLand,
  seaWay,
  seaWays,
  smoothed,
  waterGrid,
} from './water-route'

function city(plateaux: Rect[]): CityLayout {
  return {
    islands: plateaux.map((plateau, index) => ({
      path: `island-${index}`,
      layer: 2,
      plateau,
      parcels: [],
      lots: [],
    })),
    bounds: boundsOf(plateaux),
  }
}

/** Every point every quarter unit along the route. */
function along(route: readonly Point[]): Point[] {
  const points: Point[] = []
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1] as Point
    const b = route[i] as Point
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.25)
    for (let k = 0; k <= steps; k++) {
      points.push({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps })
    }
  }
  return points
}

describe('seaWay', () => {
  // Two long islands, a channel 14 u wide between them.
  const layout = city([
    { x: 0, y: 0, width: 20, height: 80 },
    { x: 34, y: 0, width: 20, height: 80 },
  ])
  const shapes = islandShapes(layout)
  const grid = waterGrid(shapes, layout.bounds)
  const beaches = shapes.map((shape) => landOutline(shape))
  const land = boundsOf(beaches.flat().map((point) => ({ ...point, width: 0, height: 0 })))
  const open = { x: land.x - 2, y: land.y - 2, width: land.width + 4, height: land.height + 4 }
  const ways = seaWays(grid, open)

  it('closes the land and leaves the sea open', () => {
    expect(onLand(grid, { x: 10, y: 40 })).toBe(true)
    expect(onLand(grid, { x: 27, y: 40 })).toBe(false)
    // Off the grid counts as land: nothing sails there.
    expect(onLand(grid, { x: -500, y: 0 })).toBe(true)
  })

  it('leaves a channel by its middle for the open sea, never touching a beach', () => {
    const from = { x: 27, y: 40 }
    const way = seaWay(ways, from)
    expect(way?.[0]).toEqual(from)
    const end = way?.at(-1) ?? from
    expect(end.y > open.y + open.height || end.y < open.y).toBe(true)
    for (const point of along(way ?? [])) {
      for (const beach of beaches) {
        expect(insidePolygon(point, beach)).toBe(false)
      }
      if (point.y > 10 && point.y < 70) {
        expect(Math.abs(point.x - 27)).toBeLessThan(2)
      }
    }
  })

  it('is the same from one call to the next', () => {
    const again = seaWay(seaWays(waterGrid(shapes, layout.bounds), open), { x: 27, y: 30 })
    expect(seaWay(ways, { x: 27, y: 30 })).toEqual(again)
  })

  it('leads two ferries out of one channel along the same line', () => {
    const a = seaWay(ways, { x: 27, y: 25 }) ?? []
    const b = seaWay(ways, { x: 27.5, y: 32 }) ?? []
    // The last 20 points, out to the sea, are the same
    expect(a.slice(-20)).toEqual(b.slice(-20))
  })

  it('has nowhere to go from the open sea already', () => {
    expect(open.x).toBeGreaterThan(-36)
    expect(seaWay(ways, { x: -37, y: 40 })).toHaveLength(2)
  })
})

describe('smoothed', () => {
  const grid = waterGrid(islandShapes(city([{ x: 0, y: 0, width: 10, height: 10 }])), {
    x: 0,
    y: 0,
    width: 10,
    height: 10,
  })

  it('rounds corners on open water, from the same start to the same end', () => {
    const line = smoothed(grid, [
      { x: -30, y: -30 },
      { x: -30, y: 40 },
      { x: 40, y: 40 },
    ])
    expect(line[0]).toEqual({ x: -30, y: -30 })
    expect(line.at(-1)).toEqual({ x: 40, y: 40 })
    expect(line).not.toContainEqual({ x: -30, y: 40 })
    expect(line.length).toBeGreaterThan(10)
  })
})
