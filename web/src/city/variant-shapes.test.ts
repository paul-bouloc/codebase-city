import { describe, expect, it } from 'vitest'
import { buildingGeometry, stretched } from './archetype-geometry'
import type { Building } from './archetypes'
import { KIT, PAVILION_HEIGHTS, type Piece, type VariantArchetype } from './variants-kit'
import { FLOOR_HEIGHT, type Vec3 } from './world/units'

const ARCHETYPES = ['house', 'pavilion', 'concreteBlock'] as const

/** The sides and floors each archetype takes from the data. */
const RANGES: Record<VariantArchetype, { sides: [number, number]; floors: number[] }> = {
  house: { sides: [0.75, 1.4999], floors: [1, 2] },
  pavilion: { sides: [0.75, 1.54], floors: [1, 2] },
  concreteBlock: { sides: [0.75, 1.7], floors: [1, 2, 3, 4] },
}

function allowed(piece: Piece, side: number, floors: number, chosen: readonly string[]) {
  const { sMin, sMax, floors: only, needs, needsAll, excludes } = piece.rule
  return (
    (sMin === undefined || side >= sMin - 1e-9) &&
    (sMax === undefined || side <= sMax + 1e-9) &&
    (only === undefined || only.includes(floors)) &&
    (needsAll ?? []).every((id) => chosen.includes(id)) &&
    (needs === undefined || needs.some((id) => chosen.includes(id))) &&
    !(excludes ?? []).some((id) => chosen.includes(id))
  )
}

/** Every combination the rules allow for this side and these floors, in the kit's order. */
function combinations(archetype: VariantArchetype, side: number, floors: number): string[][] {
  const { slots, pieces } = KIT[archetype]
  let partial: string[][] = [[]]
  for (const slot of slots) {
    partial = partial.flatMap((chosen) => {
      const candidates = pieces.filter(
        (piece) => piece.slot === slot.id && !piece.auto && allowed(piece, side, floors, chosen),
      )
      if (slot.one) {
        return candidates.map((piece) => [...chosen, piece.id])
      }
      let grown: string[][] = [chosen]
      for (const piece of candidates) {
        grown = grown.flatMap((sofar) =>
          allowed(piece, side, floors, sofar) ? [sofar, [...sofar, piece.id]] : [sofar],
        )
      }
      return grown
    })
  }
  return partial
}

function buildingOf(archetype: VariantArchetype, pieces: string[], side: number, floors: number) {
  const height =
    archetype === 'house'
      ? floors * FLOOR_HEIGHT * 0.9
      : archetype === 'pavilion'
        ? PAVILION_HEIGHTS[floors >= 2 ? 1 : 0]
        : floors * FLOOR_HEIGHT
  return { archetype, side, height, split: 0, pieces } satisfies Building
}

/** The top of the reference model of the same floors and side. */
function referenceTop({ archetype, side, height }: Building): number {
  if (archetype === 'house') {
    return height + 0.42 * 0.74 * side
  }
  return archetype === 'pavilion' ? height + 0.09 : height
}

/** Every building to check: each combination at sides 0.05 u apart, at each of its floors. */
function* everyBuilding(archetype: VariantArchetype) {
  const { sides, floors } = RANGES[archetype]
  const steps = Math.round((sides[1] - sides[0]) / 0.05)
  for (let step = 0; step <= steps; step++) {
    const side = step === steps ? sides[1] : sides[0] + step * 0.05
    for (const floor of floors) {
      for (const pieces of combinations(archetype, side, floor)) {
        yield buildingOf(archetype, pieces, side, floor)
      }
    }
  }
}

const cornersOf = (building: Building): Vec3[] =>
  buildingGeometry(building).flatMap((triangle) =>
    triangle.map((vertex) => stretched(vertex, building)),
  )

describe('variant shapes', () => {
  it('builds the combinations of the boards', () => {
    const counts = { house: 54, pavilion: 32, concreteBlock: 40 }
    for (const archetype of ARCHETYPES) {
      const keys = new Set<string>()
      for (const building of everyBuilding(archetype)) {
        keys.add(building.pieces.join('.'))
      }
      expect(keys.size).toBe(counts[archetype])
    }
  })

  it.each(ARCHETYPES)('keeps every %s under 50 triangles, in 1.8 u, on its lot', (archetype) => {
    for (const building of everyBuilding(archetype)) {
      const triangles = buildingGeometry(building)
      const label = `${building.pieces.join('.')} at ${building.side.toFixed(2)} u`
      expect(triangles.length, label).toBeLessThan(50)
      const corners = cornersOf(building)
      for (const axis of [0, 2] as const) {
        const values = corners.map((point) => point[axis])
        expect(Math.max(...values) - Math.min(...values), label).toBeLessThanOrEqual(1.8 + 1e-6)
        // Centred on its footprint
        expect(Math.abs(Math.max(...values) + Math.min(...values)), label).toBeLessThan(1e-6)
      }
      const heights = corners.map((point) => point[1])
      expect(Math.min(...heights), label).toBeCloseTo(0)
      expect(Math.max(...heights), label).toBeLessThanOrEqual(referenceTop(building) + 0.4 + 1e-6)
    }
  })

  it.each(ARCHETYPES)('winds every triangle of every %s along its normal', (archetype) => {
    for (const building of everyBuilding(archetype)) {
      for (const triangle of buildingGeometry(building)) {
        const [a, b, c] = triangle.map((vertex) => stretched(vertex, building)) as [
          Vec3,
          Vec3,
          Vec3,
        ]
        const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
        const v: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
        const [x, y, z] = triangle[0].normal
        const dot =
          (u[1] * v[2] - u[2] * v[1]) * x +
          (u[2] * v[0] - u[0] * v[2]) * y +
          (u[0] * v[1] - u[1] * v[0]) * z
        expect(dot, building.pieces.join('.')).toBeGreaterThan(0)
      }
    }
  })

  it('stamps one face of every combination, the one a generated file shows its bars on', () => {
    for (const archetype of ARCHETYPES) {
      for (const pieces of combinations(archetype, 1.2, 1)) {
        const building = buildingOf(archetype, pieces, 1.2, 1)
        const stamped = buildingGeometry(building).filter((triangle) => triangle[0].stamped === 1)
        expect(stamped.length, pieces.join('.')).toBeGreaterThan(0)
        // Turned up: a roof or a top
        for (const triangle of stamped) {
          expect(triangle[0].normal[1]).toBeGreaterThan(0.5)
        }
      }
    }
  })

  it('stamps every face of a combination around one centre, so its three bars line up', () => {
    for (const archetype of ARCHETYPES) {
      for (const building of everyBuilding(archetype)) {
        const centres = new Set(
          buildingGeometry(building)
            .filter((triangle) => triangle[0].stamped === 1)
            .map((triangle) => triangle[0].stampCentre.map((value) => value.toFixed(6)).join(',')),
        )
        expect(centres.size, building.pieces.join('.')).toBe(1)
      }
    }
  })

  it('shows the bars on the rim panel of a concrete block, which covers its top', () => {
    let panels = 0
    for (const building of everyBuilding('concreteBlock')) {
      // The panel is the only face painted 12 % towards ink
      for (const triangle of buildingGeometry(building)) {
        if (Math.abs(triangle[0].paint[3] - 0.12) < 1e-9) {
          panels++
          expect(triangle[0].stamped, building.pieces.join('.')).toBe(1)
        }
      }
    }
    expect(panels).toBeGreaterThan(0)
  })

  it('raises a pavilion of two floors to 1 u under its roof', () => {
    const low = cornersOf(buildingOf('pavilion', ['BW', 'D', 'F'], 1.2, 1))
    const high = cornersOf(buildingOf('pavilion', ['BW', 'D', 'F'], 1.2, 2))
    const top = (points: Vec3[]) => Math.max(...points.map((point) => point[1]))
    expect(top(low)).toBeCloseTo(0.75 + 0.09)
    expect(top(high)).toBeCloseTo(1 + 0.09)
  })

  it('cuts a notched block, and lowers the front wing of a winged one by a floor', () => {
    const notched = cornersOf(buildingOf('concreteBlock', ['N', 'F'], 1.5, 2))
    // The front right corner is missing (the board's front, y+, is three.js −z)
    const frontRight = notched.filter(
      (point) => point[0] > 0.6 && point[2] < -0.6 && point[1] > 0.5,
    )
    expect(frontRight).toHaveLength(0)
    const winged = cornersOf(buildingOf('concreteBlock', ['W', 'F'], 1.5, 3))
    const front = winged.filter((point) => point[2] < -0.7)
    expect(Math.max(...front.map((point) => point[1]))).toBeCloseTo(1.5 - 0.5)
  })
})
