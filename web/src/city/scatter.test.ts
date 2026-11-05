import { describe, expect, it } from 'vitest'
import { buildingGeometry, stretched } from './archetype-geometry'
import { buildingFor } from './archetypes'
import type { FileMetrics } from './layout'
import { baseTurnFor, placedReach, placementFor } from './scatter'

const file = (metrics: Partial<FileMetrics>): FileMetrics => ({
  language: 'typescript',
  lines: 100,
  complexity: 1,
  test: false,
  ...metrics,
})

describe('placementFor', () => {
  it('keeps towers and blocks in line, centred', () => {
    for (const complexity of [10, 40, 200, 2000]) {
      const building = buildingFor(file({ complexity }))
      expect(placementFor(building, 3, 5)).toEqual({ dx: 0, dy: 0, angle: 0 })
    }
  })

  it('moves and turns low buildings without leaving their room', () => {
    let moved = 0
    for (const test of [false, true]) {
      for (const lines of [0, 50, 400, 1500, 3000]) {
        const building = buildingFor(file({ lines, test }))
        for (let lot = 0; lot < 50; lot++) {
          const placement = placementFor(building, lot * 2 + 1, 7)
          expect(placedReach(building, placement)).toBeLessThanOrEqual(0.9 + 1e-9)
          expect(Math.abs(placement.angle)).toBeLessThanOrEqual((15 * Math.PI) / 180)
          moved += placement.dx !== 0 || placement.angle !== 0 ? 1 : 0
        }
      }
    }
    // All but the 3,000-line files: a Hall, and a Pavilion that both fill their lot
    expect(moved).toBe(400)
  })

  it('scatters low concrete blocks, except on concrete ground', () => {
    const low = buildingFor(file({ lines: 200, analyzed: false }))
    const tall = buildingFor(file({ lines: 600, analyzed: false }))
    const aligned = { dx: 0, dy: 0, angle: 0 }
    expect(placementFor(low, 3, 5, 'normal')).not.toEqual(aligned)
    expect(placementFor(low, 3, 5, 'tests')).not.toEqual(aligned)
    expect(placementFor(low, 3, 5, 'unanalyzed')).toEqual(aligned)
    expect(placementFor(tall, 3, 5, 'normal')).toEqual(aligned)
    expect(placedReach(low, placementFor(low, 3, 5))).toBeLessThanOrEqual(0.9 + 1e-9)
  })

  it('gives a lot the same placement every time', () => {
    const building = buildingFor(file({ test: true }))
    expect(placementFor(building, 11, 3)).toEqual(placementFor(building, 11, 3))
    expect(placementFor(building, 11, 3)).not.toEqual(placementFor(building, 13, 3))
  })

  it('keeps every variant of a low building in its room, from any base turn', () => {
    for (const metrics of [{ test: false }, { test: true }, { analyzed: false }]) {
      for (const lines of [0, 50, 200, 400, 900, 1500, 1869]) {
        for (let file_ = 0; file_ < 40; file_++) {
          const path = `src/part-${file_}.ts`
          const building = buildingFor(file({ ...metrics, lines, path }))
          for (const turn of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
            const placement = placementFor(building, file_ * 2 + 1, 7, 'normal', turn)
            expect(placedReach(building, placement), building.pieces.join('.')).toBeLessThanOrEqual(
              0.9 + 1e-9,
            )
            expect(Math.abs(placement.angle - turn)).toBeLessThanOrEqual(
              (15 * Math.PI) / 180 + 1e-9,
            )
          }
        }
      }
    }
  })
})

describe('baseTurnFor', () => {
  const grid = { x: 0, y: 0, width: 10, height: 6 }
  const house = buildingFor(file({ lines: 400 }))

  /** Where the front of the house points, on the board, once turned. */
  function front(angle: number): [number, number] {
    // The board's front, y+, is three.js −z; makeRotationY turns (x, z) to (x c + z s, z c − x s)
    const [x, z] = [-Math.sin(angle), -Math.cos(angle)]
    return [Math.round(x), Math.round(-z)]
  }

  it('turns a house to face the nearest side of its grid', () => {
    expect(house.archetype).toBe('house')
    expect(front(baseTurnFor(house, 'a.ts', 5, 5, grid))).toEqual([0, 1])
    expect(front(baseTurnFor(house, 'a.ts', 5, 1, grid))).toEqual([0, -1])
    expect(front(baseTurnFor(house, 'a.ts', 1, 3, grid))).toEqual([-1, 0])
    expect(front(baseTurnFor(house, 'a.ts', 9, 3, grid))).toEqual([1, 0])
    // Without a grid, as the design draws it
    expect(baseTurnFor(house, 'a.ts', 5, 5)).toBe(0)
  })

  it('points the front of the model the way it says', () => {
    // The porch (the front, y+ on the board) of a turned house lies towards the nearest side
    const building = { ...house, pieces: ['S', 'G', 'vr'] as const }
    const angle = baseTurnFor(building, 'a.ts', 9, 3, grid)
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)]
    const xs = buildingGeometry(building).flatMap((triangle) =>
      triangle
        .filter((vertex) => vertex.paint[3] === 0.75)
        .map((vertex) => {
          const [x, , z] = stretched(vertex, building)
          return x * cos + z * sin
        }),
    )
    // The porch stands towards x+ on the board: the side the house faces
    expect(Math.min(...xs)).toBeGreaterThan(0)
  })

  it('turns pavilions and concrete blocks by whole quarters drawn from their path', () => {
    const pavilion = buildingFor(file({ test: true }))
    const turns = new Set(
      Array.from({ length: 200 }, (_, i) => baseTurnFor(pavilion, `test/t-${i}.ts`, 1, 1)),
    )
    expect([...turns].map((turn) => Math.round(turn / (Math.PI / 2))).sort()).toEqual([0, 1, 2, 3])
    const tower = buildingFor(file({ complexity: 2000 }))
    expect(baseTurnFor(tower, 'src/a.ts', 1, 1)).toBe(0)
  })
})
