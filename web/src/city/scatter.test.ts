import { describe, expect, it } from 'vitest'
import { buildingFor } from './archetypes'
import type { FileMetrics } from './layout'
import { placedReach, placementFor } from './scatter'

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

  it('gives a lot the same placement every time', () => {
    const building = buildingFor(file({ test: true }))
    expect(placementFor(building, 11, 3)).toEqual(placementFor(building, 11, 3))
    expect(placementFor(building, 11, 3)).not.toEqual(placementFor(building, 13, 3))
  })
})
