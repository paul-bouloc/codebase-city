import { describe, expect, it } from 'vitest'
import { islandShapes } from './island-shape'
import { boundsOf, type CityLayout, type Point, type Rect } from './layout'
import { insidePolygon, landOutline, onLand, waterGrid, waterRoute } from './water-route'

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

describe('waterRoute', () => {
  // A wall of an island between two small ones, west and east of it.
  const layout = city([
    { x: 0, y: 40, width: 12, height: 10 },
    { x: 30, y: 0, width: 14, height: 90 },
    { x: 62, y: 40, width: 12, height: 10 },
  ])
  const shapes = islandShapes(layout)
  const grid = waterGrid(shapes, layout.bounds)
  const beaches = shapes.map((shape) => landOutline(shape))

  it('closes the land and leaves the sea open', () => {
    expect(onLand(grid, { x: 37, y: 45 })).toBe(true)
    expect(onLand(grid, { x: 6, y: 45 })).toBe(true)
    expect(onLand(grid, { x: 20, y: -30 })).toBe(false)
    // Off the grid counts as land: nothing sails there.
    expect(onLand(grid, { x: -500, y: 0 })).toBe(true)
  })

  it('goes round an island in the way, and never touches a beach', () => {
    const from = { x: -12, y: 45 }
    const to = { x: 86, y: 45 }
    const route = waterRoute(grid, from, to)
    expect(route).not.toBeNull()
    expect(route?.[0]).toEqual(from)
    expect(route?.at(-1)).toEqual(to)
    for (const point of along(route ?? [])) {
      for (const beach of beaches) {
        expect(insidePolygon(point, beach)).toBe(false)
      }
    }
    // Round the wall's north or south end, not through it.
    const ys = (route ?? []).map((point) => point.y)
    expect(Math.max(...ys) > 90 || Math.min(...ys) < 0).toBe(true)
  })

  it('is the same from one call to the next', () => {
    const a = waterRoute(grid, { x: -12, y: 45 }, { x: 86, y: 45 })
    const b = waterRoute(waterGrid(shapes, layout.bounds), { x: -12, y: 45 }, { x: 86, y: 45 })
    expect(a).toEqual(b)
  })

  it('keeps off a shore it could hug, when the sea leaves room', () => {
    const long = city([{ x: 0, y: 0, width: 100, height: 12 }])
    const [shape] = islandShapes(long)
    const beach = shape ? landOutline(shape) : []
    const top = Math.max(...beach.map((point) => point.y))
    // Both ends just off the north beach: a straight line would run along it.
    const route = waterRoute(
      waterGrid(islandShapes(long), long.bounds),
      { x: 10, y: top + 1.5 },
      { x: 90, y: top + 1.5 },
    )
    const farthest = Math.max(...(route ?? []).map((point) => point.y - top))
    expect(farthest).toBeGreaterThan(4)
  })

  it('leaves the grid as it found it, for the next route', () => {
    const fresh = waterGrid(shapes, layout.bounds)
    const second = waterRoute(fresh, { x: 6, y: -15 }, { x: 68, y: 70 })
    waterRoute(grid, { x: -12, y: 45 }, { x: 86, y: 45 })
    expect(waterRoute(grid, { x: 6, y: -15 }, { x: 68, y: 70 })).toEqual(second)
    expect(grid.scratch.done.every((cell) => cell === 0)).toBe(true)
    expect(grid.scratch.cameFrom.every((cell) => cell === -1)).toBe(true)
  })

  it('sails straight when nothing is in the way', () => {
    const route = waterRoute(grid, { x: -20, y: -20 }, { x: -20, y: 100 })
    expect(route).toHaveLength(2)
  })
})
