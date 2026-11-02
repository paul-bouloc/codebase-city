import { describe, expect, it } from 'vitest'
import { type Canals, islandCanals } from './canals'
import type { IslandLayout, Rect } from './layout'

function island(plateau: Rect, folders: Rect[], square?: Rect): IslandLayout {
  return {
    path: 'island',
    layer: 1,
    plateau,
    parcels: folders.map((rect) => ({ rect, level: 1, nature: 'normal' })),
    lots: [],
    ...(square ? { square } : {}),
  }
}

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))

const area = (canals: Canals) =>
  canals.cells.reduce((sum, cell) => sum + cell.rect.width * cell.rect.height, 0)

describe('islandCanals', () => {
  // Two rows of folders, 1.8 u apart, reaching the plateau's margin on every side:
  //   C (0.9 to 20.1) | D (21.9 to 29.1)    y 10.9 to 19.1
  //   A (0.9 to 14.1) | B (15.9 to 29.1)    y 0.9 to 9.1
  const folders = [
    { x: 0.9, y: 0.9, width: 13.2, height: 8.2 },
    { x: 15.9, y: 0.9, width: 13.2, height: 8.2 },
    { x: 0.9, y: 10.9, width: 19.2, height: 8.2 },
    { x: 21.9, y: 10.9, width: 7.2, height: 8.2 },
  ]
  const canals = islandCanals(island({ x: 0, y: 0, width: 30, height: 20 }, folders))

  it('fills the gaps between folders, and only them', () => {
    // Two canals along y and one along x, 1.8 u wide
    expect(area(canals)).toBeCloseTo(1.8 * (8.2 + 28.2 + 8.2))
    for (const cell of canals.cells) {
      for (const folder of folders) {
        expect(overlap(cell.rect, folder)).toBeCloseTo(0, 9)
      }
    }
  })

  it('pours each canal over the edge where it meets the margin', () => {
    const mouths = canals.cells.flatMap((cell) => (cell.mouth ? [cell.mouth] : []))
    expect(mouths.sort()).toEqual(['east', 'north', 'south', 'west'])
    const south = canals.cells.find((cell) => cell.mouth === 'south')
    expect(south?.rect).toEqual({ x: 14.1, y: 0.9, width: 1.8, height: 8.2 })
    expect(south?.quays).toEqual({ west: true, east: true, south: false, north: false })
  })

  it('lays a quay along the folders, none where two canals meet', () => {
    // Where the canal between A and B meets the one along x, under C
    const tee = canals.cells.find((cell) => cell.rect.x === 14.1 && cell.rect.y === 9.1)
    expect(tee?.quays).toEqual({ west: false, east: false, south: false, north: true })
  })

  it("turns the quays around the folders' corners on each crossing", () => {
    // Under C, the corners of A and B; over B, those of C and D
    expect(canals.bends).toEqual(
      expect.arrayContaining([
        { x: 14.1, y: 9.1, sx: 1, sy: 1 },
        { x: 15.9, y: 9.1, sx: -1, sy: 1 },
        { x: 20.1, y: 10.9, sx: 1, sy: -1 },
        { x: 21.9, y: 10.9, sx: -1, sy: -1 },
      ]),
    )
    expect(canals.bends).toHaveLength(4)
  })

  it('spans each long canal with a footbridge, never over a crossing', () => {
    // Between A and B, C and D, A and C, B and D; not between B and C (4.2 u)
    expect(canals.footbridges).toHaveLength(4)
    for (const { rect } of canals.footbridges) {
      expect(Math.min(rect.width, rect.height)).toBeCloseTo(0.6)
      expect(Math.max(rect.width, rect.height)).toBeCloseTo(1.8)
      for (const folder of folders) {
        expect(overlap(rect, folder)).toBeCloseTo(0, 9)
      }
    }
  })

  it('joins canals that do not line up, in one stretch of water each', () => {
    // The gap of the top row is 0.9 u east of the bottom row's
    //   C (0.9 to 15.0) | D (16.8 to 29.1)
    //   A (0.9 to 14.1) | B (15.9 to 29.1)
    const offset = islandCanals(
      island({ x: 0, y: 0, width: 30, height: 20 }, [
        folders[0] as Rect,
        folders[1] as Rect,
        { x: 0.9, y: 10.9, width: 14.1, height: 8.2 },
        { x: 16.8, y: 10.9, width: 12.3, height: 8.2 },
      ]),
    )
    // Every point of the canal along x is water, and only one cell spans each canal's width
    const water = (x: number, y: number) =>
      offset.cells.some(
        ({ rect, quays }) =>
          x >= rect.x + (quays.west ? 0.3 : 0) &&
          x <= rect.x + rect.width - (quays.east ? 0.3 : 0) &&
          y >= rect.y + (quays.south ? 0.3 : 0) &&
          y <= rect.y + rect.height - (quays.north ? 0.3 : 0),
      )
    for (let x = 1.5; x < 28.5; x += 0.1) {
      expect(water(x, 10)).toBe(true)
    }
    const mouths = offset.cells.filter((cell) => cell.mouth)
    expect(mouths.map((cell) => [cell.mouth, cell.rect.width])).toEqual(
      expect.arrayContaining([
        ['south', 1.8],
        ['north', 1.8],
      ]),
    )
    expect(mouths).toHaveLength(4)
  })

  it('leaves strips along a grid and dead ends paved', () => {
    // A folder and the island's own square 1.8 u apart; the square stands 0.4 u off the margin
    const shallow = islandCanals(
      island({ x: 0, y: 0, width: 20, height: 10 }, [{ x: 0.9, y: 0.9, width: 8.2, height: 8.2 }], {
        x: 10.9,
        y: 1.3,
        width: 6.1,
        height: 7.4,
      }),
    )
    expect(shallow.cells.map((cell) => cell.rect)).toEqual([
      { x: 9.1, y: 1.3, width: 1.8, height: 7.4 },
    ])
    expect(shallow.cells[0]?.mouth).toBeUndefined()
    expect(shallow.footbridges).toHaveLength(1)
  })

  it('runs a canal along the square of the island, centred in its cell', () => {
    // The square stands 2.4 u from the folder east of it: farther than a canal, yet facing it
    const square = { x: 0.9, y: 0.9, width: 8.6, height: 8.2 }
    const east = { x: 11.9, y: 0.9, width: 9.2, height: 8.2 }
    const canals = islandCanals(island({ x: 0, y: 0, width: 22, height: 10 }, [east], square))
    expect(canals.cells.map((cell) => cell.rect)).toEqual([
      { x: 10.1, y: 0.9, width: 1.8, height: 8.2 },
    ])
    // Farther still, it is no canal: paving
    const far = { ...east, x: 13.1, width: 8 }
    expect(
      islandCanals(island({ x: 0, y: 0, width: 22, height: 10 }, [far], square)).cells,
    ).toEqual([])
  })

  it('digs no canal on an island of one folder', () => {
    const single = islandCanals(
      island({ x: 0, y: 0, width: 12, height: 8 }, [{ x: 0.9, y: 0.9, width: 10.2, height: 6.2 }]),
    )
    expect(single).toEqual({ cells: [], footbridges: [], bends: [] })
  })
})
