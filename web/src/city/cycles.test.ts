import { describe, expect, it } from 'vitest'
import { indexCycles, loopThrough } from './cycles'
import type { CityLayout, FileCycle, IslandLayout } from './world/layout'

function island(lots: number): IslandLayout {
  return {
    path: 'src',
    layer: 1,
    plateau: { x: 0, y: 0, width: 10, height: 10 },
    parcels: [],
    lots: Array.from({ length: lots }, () => ({
      x: 1,
      y: 1,
      file: { language: 'typescript', lines: 10, complexity: 1, test: false },
    })),
  }
}

/** Two islands of 3 and 4 files: buildings 0 to 2, then 3 to 6. */
function city(cycles: FileCycle[]): CityLayout {
  return {
    islands: [island(3), island(4)],
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    cycles,
  }
}

describe('indexCycles', () => {
  it('finds the cycle of each member, by building', () => {
    const index = indexCycles(
      city([
        {
          members: [
            { island: 1, lot: 0 },
            { island: 1, lot: 2 },
          ],
          loop: [1, 0],
          imports: [
            [0, 1],
            [1, 0],
          ],
        },
      ]),
    )
    const cycle = index.cycleOf.get(5)
    expect(cycle?.members).toEqual([3, 5])
    expect(cycle?.loop).toEqual([5, 3])
    expect(cycle?.next.get(3)).toEqual([5])
    expect(index.cycleOf.get(3)).toBe(cycle)
    expect(index.cycleOf.has(4)).toBe(false)
  })
})

describe('loopThrough', () => {
  // 0 → 1 → 2 → 0, and 2 → 3 → 2: the shortest loop through 3 is 3 → 2 → 3.
  const ring = indexCycles(
    city([
      {
        members: [0, 1, 2, 3].map((lot) => ({ island: lot < 3 ? 0 : 1, lot: lot % 3 })),
        loop: [0, 1, 2],
        imports: [
          [0, 1],
          [1, 2],
          [2, 0],
          [2, 3],
          [3, 2],
        ],
      },
    ]),
  ).cycles[0]

  it('runs from the building, the shortest way back', () => {
    expect(ring && loopThrough(ring, 3)).toEqual([3, 2])
    expect(ring && loopThrough(ring, 1)).toEqual([1, 2, 0])
    expect(ring && loopThrough(ring, 2)).toEqual([2, 3])
  })

  it('falls back on the stored loop when no plain import closes one', () => {
    const open = ring && { ...ring, next: new Map([[0, [1]]]) }
    expect(open && loopThrough(open, 0)).toEqual([0, 1, 2])
  })
})
