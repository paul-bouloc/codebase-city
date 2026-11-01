import { describe, expect, it } from 'vitest'
import { archetypeGeometry, stretched } from './archetype-geometry'
import { ARCHETYPES, type Archetype, type Building, buildingFor } from './archetypes'
import type { Vec3 } from './units'

const TRIANGLES: Record<Archetype, number> = {
  pavilion: 50,
  hall: 34,
  house: 16,
  smallBlock: 20,
  setbackBlock: 30,
  pyramidRoof: 14,
  towerOnPodium: 40,
  concreteBlock: 10,
}

/** The highest complexity that still picks each archetype. */
const MAX_COMPLEXITY: Record<Archetype, number> = {
  pavilion: 1,
  hall: 3,
  house: 3,
  smallBlock: 15,
  setbackBlock: 51,
  pyramidRoof: 117,
  towerOnPodium: 10_000,
  concreteBlock: 0,
}

/** The largest building of an archetype. */
function largest(archetype: Archetype): Building {
  const building = buildingFor({
    language: 'typescript',
    lines: archetype === 'house' ? 1869 : 3000,
    complexity: MAX_COMPLEXITY[archetype],
    test: archetype === 'pavilion',
    analyzed: archetype !== 'concreteBlock',
  })
  expect(building.archetype).toBe(archetype)
  return building
}

function corners(archetype: Archetype, building: Building): Vec3[] {
  return archetypeGeometry(archetype).flatMap((triangle) =>
    triangle.map((vertex) => stretched(vertex, building)),
  )
}

function extent(points: Vec3[], axis: 0 | 1 | 2): [number, number] {
  const values = points.map((point) => point[axis])
  return [Math.min(...values), Math.max(...values)]
}

const top = (archetype: Archetype, building: Building) => extent(corners(archetype, building), 1)[1]

describe('archetypeGeometry', () => {
  it.each(ARCHETYPES)('builds %s from its budget of triangles', (archetype) => {
    expect(archetypeGeometry(archetype)).toHaveLength(TRIANGLES[archetype])
    expect(TRIANGLES[archetype]).toBeLessThanOrEqual(50)
  })

  it.each(ARCHETYPES)('fits the largest %s in 1.8 × 1.8 u, standing on its lot', (archetype) => {
    const points = corners(archetype, largest(archetype))
    for (const axis of [0, 2] as const) {
      const [min, max] = extent(points, axis)
      expect(min).toBeGreaterThanOrEqual(-0.9 - 1e-6)
      expect(max).toBeLessThanOrEqual(0.9 + 1e-6)
    }
    expect(extent(points, 1)[0]).toBe(0)
  })

  it.each(ARCHETYPES)('winds every triangle of %s along its normal', (archetype) => {
    const building = largest(archetype)
    for (const [first, second, third] of archetypeGeometry(archetype)) {
      const [a, b, c] = [first, second, third].map((vertex) => stretched(vertex, building)) as [
        Vec3,
        Vec3,
        Vec3,
      ]
      const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const v: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
      const [x, y, z] = first.normal
      const dot =
        (u[1] * v[2] - u[2] * v[1]) * x +
        (u[2] * v[0] - u[0] * v[2]) * y +
        (u[0] * v[1] - u[1] * v[0]) * z
      expect(dot).toBeGreaterThan(0)
    }
  })

  it('turns the faces outwards', () => {
    const building: Building = { archetype: 'smallBlock', side: 1, height: 2, split: 0 }
    const roof = archetypeGeometry('smallBlock').find((triangle) =>
      triangle.every((vertex) => stretched(vertex, building)[1] === 2),
    )
    expect(roof?.[0].normal[1]).toBe(1)
  })

  it.each(ARCHETYPES)('starts every line of %s on a vertex and ends it on another', (archetype) => {
    for (const triangle of archetypeGeometry(archetype)) {
      triangle.forEach((vertex, k) => {
        expect(vertex.edge[k]).toBe(1)
      })
      for (const j of [0, 1, 2]) {
        const others = triangle.filter((_, k) => k !== j).map((vertex) => vertex.edge[j])
        // Either a line along the side (0 at both ends) or no line at all (1 everywhere).
        expect(others[0]).toBe(others[1])
      }
      expect(triangle.some((vertex) => vertex.edge.includes(0))).toBe(true)
    }
  })

  it.each(ARCHETYPES)('draws no line between coplanar triangles of %s', (archetype) => {
    const building = largest(archetype)
    const key = (point: Vec3) => point.map((value) => value.toFixed(5)).join(',')
    const sides = new Map<string, { normal: Vec3; line: boolean }[]>()
    for (const triangle of archetypeGeometry(archetype)) {
      const points = triangle.map((vertex) => key(stretched(vertex, building)))
      for (const j of [0, 1, 2]) {
        const side = points
          .filter((_, k) => k !== j)
          .sort()
          .join('|')
        const entry = { normal: triangle[0].normal, line: triangle[(j + 1) % 3]?.edge[j] === 0 }
        sides.set(side, [...(sides.get(side) ?? []), entry])
      }
    }
    for (const shared of sides.values()) {
      const [a, b] = shared
      if (a && b && key(a.normal) === key(b.normal)) {
        expect(a.line || b.line).toBe(false)
      }
    }
  })

  it('outlines a flat roof with its four sides only', () => {
    const building: Building = { archetype: 'smallBlock', side: 1, height: 2, split: 0 }
    const roof = archetypeGeometry('smallBlock').filter((triangle) =>
      triangle.every((vertex) => stretched(vertex, building)[1] === 2),
    )
    const lines = roof.flatMap((triangle) =>
      [0, 1, 2].filter((j) => triangle[(j + 1) % 3]?.edge[j] === 0),
    )
    expect(roof).toHaveLength(2)
    expect(lines).toHaveLength(4)
  })

  it('keeps the crown and antenna of a tower at their size in u', () => {
    const tower = (side: number, height: number) =>
      top('towerOnPodium', { archetype: 'towerOnPodium', side, height, split: 0 }) - height
    expect(tower(0.8, 8.5)).toBeCloseTo(1.55)
    expect(tower(1.7, 20)).toBeCloseTo(1.55)
  })

  it('keeps the roof of a Pyramid roof as the shaft rises', () => {
    const roof = (height: number) =>
      top('pyramidRoof', { archetype: 'pyramidRoof', side: 1.4, height, split: 0 }) - height
    expect(roof(5.5)).toBeCloseTo(0.62 * 0.84 * 1.4)
    expect(roof(8)).toBeCloseTo(roof(5.5))
  })

  it('keeps the kiosk of a Small block at 0.42 × 0.42 × 0.3 u', () => {
    for (const side of [0.75, 1.7]) {
      const building: Building = { archetype: 'smallBlock', side, height: 2, split: 0 }
      const kiosk = corners('smallBlock', building).filter((point) => point[1] > 2 + 1e-6)
      const [x0, x1] = extent(kiosk, 0)
      expect(x1 - x0).toBeCloseTo(0.42)
      expect(extent(kiosk, 1)[1]).toBeCloseTo(2.3)
    }
  })
})
