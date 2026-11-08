import { describe, expect, it } from 'vitest'
import type { IslandLayout, Rect } from '../world/layout'
import { islandCanals } from './canals'
import { islandGardens } from './gardens'

const lot = (x: number, y: number) => ({
  x,
  y,
  file: { language: 'typescript' as const, lines: 10, complexity: 1, test: false },
})

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width - 0.01 &&
  b.x < a.x + a.width - 0.01 &&
  a.y < b.y + b.height - 0.01 &&
  b.y < a.y + a.height - 0.01

describe('islandGardens', () => {
  it('turns the room a small island leaves into a garden, a street away from its square', () => {
    // The minimum plateau, with two files in its west corner
    const island: IslandLayout = {
      path: 'tiny',
      layer: 1,
      plateau: { x: 0, y: 0, width: 10, height: 6.6 },
      parcels: [],
      lots: [lot(2.2, 2.2), lot(4.2, 2.2)],
      square: { x: 0.9, y: 0.9, width: 4.6, height: 2.6 },
    }
    const gardens = islandGardens(island, [])
    expect(gardens.length).toBeGreaterThan(0)
    for (const garden of gardens) {
      expect(overlaps(garden, island.square as Rect)).toBe(false)
      expect(garden.width).toBeGreaterThanOrEqual(2)
      expect(garden.height).toBeGreaterThanOrEqual(2)
    }
    // East of the square, from a street's width past it to the margin
    expect(gardens[0]).toEqual({ x: 6.4, y: 0.9, width: 2.7, height: 4.8 })
  })

  it('never lays a garden on a folder or a canal, and leaves thin strips paved', () => {
    // Two folders face to face across a canal, and a strip 1.5 u wide left to the north
    const island: IslandLayout = {
      path: 'canal',
      layer: 1,
      plateau: { x: 0, y: 0, width: 21.6, height: 9.3 },
      parcels: [
        { rect: { x: 0.9, y: 0.9, width: 9, height: 6 }, level: 1, nature: 'normal' },
        { rect: { x: 11.7, y: 0.9, width: 9, height: 6 }, level: 1, nature: 'normal' },
      ],
      lots: [],
    }
    const canals = islandCanals(island).cells
    expect(canals.length).toBeGreaterThan(0)
    const gardens = islandGardens(island, canals)
    expect(gardens).toEqual([])
  })

  it('finds room between folders when there is enough', () => {
    const island: IslandLayout = {
      path: 'room',
      layer: 1,
      plateau: { x: 0, y: 0, width: 30, height: 12 },
      parcels: [{ rect: { x: 0.9, y: 0.9, width: 10, height: 10.2 }, level: 1, nature: 'normal' }],
      lots: [],
    }
    const gardens = islandGardens(island, islandCanals(island).cells)
    expect(gardens).toEqual([{ x: 11.8, y: 0.9, width: 17.3, height: 10.2 }])
  })

  it('stays fast on an island of thousands of folders', () => {
    // 4,096 folders, 64 × 64, offset row by row so that their edges never line up
    const parcels = Array.from({ length: 4096 }, (_, n) => ({
      rect: {
        x: 0.9 + 5 * (n % 64) + (n % 7) * 0.1,
        y: 0.9 + 5 * Math.floor(n / 64),
        width: 3,
        height: 3,
      },
      level: 1,
      nature: 'normal' as const,
    }))
    const island: IslandLayout = {
      path: 'many',
      layer: 1,
      plateau: { x: 0, y: 0, width: 5 * 64 + 1.8, height: 5 * 64 + 1.8 },
      parcels,
      lots: [],
    }
    const start = performance.now()
    islandGardens(island, [])
    expect(performance.now() - start).toBeLessThan(250)
  })
})
