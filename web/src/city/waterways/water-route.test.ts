import { describe, expect, it } from 'vitest'
import { islandShapes } from '../terrain/island-shape'
import { boundsOf, type CityLayout, type Point, type Rect } from '../world/layout'
import { insidePolygon, landOutline, onLand, waterGrid } from './water-grid'
import { ferryRoute, smoothed, spline } from './water-route'

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

describe('ferryRoute', () => {
  // A wall of an island between two small ones, west and east of it.
  const layout = city([
    { x: 0, y: 40, width: 12, height: 10 },
    { x: 30, y: 0, width: 14, height: 90 },
    { x: 62, y: 40, width: 12, height: 10 },
  ])
  const shapes = islandShapes(layout)
  const beaches = shapes.map((shape) => landOutline(shape))
  const west = { x: -1, y: 0 }
  const east = { x: 1, y: 0 }
  const route = () =>
    ferryRoute(waterGrid(shapes, layout.bounds), { x: -14, y: 45 }, west, { x: 88, y: 45 }, east)

  it('closes the land and leaves the sea open', () => {
    const grid = waterGrid(shapes, layout.bounds)
    expect(onLand(grid, { x: 37, y: 45 })).toBe(true)
    expect(onLand(grid, { x: 20, y: -30 })).toBe(false)
    // Off the grid counts as land: nothing sails there.
    expect(onLand(grid, { x: -500, y: 0 })).toBe(true)
  })

  it('goes round an island in the way, from pier to pier, never touching a beach', () => {
    const line = route() ?? []
    expect(line[0]).toEqual({ x: -14, y: 45 })
    expect(line.at(-1)).toEqual({ x: 88, y: 45 })
    for (const point of along(line)) {
      for (const beach of beaches) {
        expect(insidePolygon(point, beach)).toBe(false)
      }
    }
    const ys = line.map((point) => point.y)
    expect(Math.max(...ys) > 90 || Math.min(...ys) < 0).toBe(true)
  })

  it('leaves its pier straight out, and bends wide, never in a corner (45° a unit at most)', () => {
    const line = route() ?? []
    // The first 2 u go west, off the pier
    const early = line.filter((point) => Math.hypot(point.x + 14, point.y - 45) < 2)
    for (const point of early) {
      expect(Math.abs(point.y - 45)).toBeLessThan(0.3)
    }
    for (let i = 2; i < line.length; i++) {
      const a = line[i - 2] as Point
      const b = line[i - 1] as Point
      const c = line[i] as Point
      const turn = Math.abs(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x))
      expect(Math.min(turn, 2 * Math.PI - turn)).toBeLessThan(Math.PI / 4)
    }
  })

  it('sails a second ferry beside the first, not over it', () => {
    const grid = waterGrid(shapes, layout.bounds)
    const first = ferryRoute(grid, { x: -14, y: 45 }, west, { x: 88, y: 45 }, east) ?? []
    const second = ferryRoute(grid, { x: -14, y: 46 }, west, { x: 88, y: 46 }, east) ?? []
    // Halfway, they are apart
    const middle = second[Math.floor(second.length / 2)] ?? { x: 0, y: 0 }
    const gap = Math.min(
      ...first.map((point) => Math.hypot(point.x - middle.x, point.y - middle.y)),
    )
    expect(gap).toBeGreaterThan(1.5)
  })

  it('is the same from one call to the next', () => {
    expect(route()).toEqual(route())
  })
})

describe('spline', () => {
  it('passes through every point, from the first to the last', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]
    const curve = spline(points)
    expect(curve[0]).toEqual(points[0])
    expect(curve.at(-1)?.x).toBeCloseTo(10)
    expect(curve.at(-1)?.y).toBeCloseTo(10)
    expect(curve.some((point) => Math.hypot(point.x - 10, point.y) < 1e-9)).toBe(true)
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
