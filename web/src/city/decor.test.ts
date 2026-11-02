import { describe, expect, it } from 'vitest'
import { CROWN_RADIUS, cityDecor, type Tree } from './decor'
import { DECOR_MODELS } from './decor-mesh'
import { islandShapes } from './island-shape'
import type { CityLayout, IslandLayout, Lot, ParcelNature } from './layout'
import { layerAltitude, slabTop } from './units'

const file = { language: 'typescript' as const, lines: 10, complexity: 1, test: false }
const lot = (x: number, y: number): Lot => ({ x, y, file })

/**
 * One island of `layer`, one folder of `nature` holding a grid of `columns` × `rows` lots, a
 * file on one lot in `every`.
 */
function island(
  path: string,
  nature: ParcelNature,
  { columns = 20, rows = 20, every = 2, layer = 1, x = 0 } = {},
): IslandLayout {
  const grid = { x: x + 1.2, y: 1.2, width: 2 * columns, height: 2 * rows }
  const lots: Lot[] = []
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if ((row * columns + column) % every === 0) {
        lots.push({
          x: grid.x + 2 * column + 1,
          y: grid.y + 2 * row + 1,
          file,
          base: slabTop(1),
          ground: nature,
        })
      }
    }
  }
  const parcel = {
    x: grid.x - 0.3,
    y: grid.y - 0.3,
    width: grid.width + 0.6,
    height: grid.height + 0.6,
  }
  return {
    path,
    layer,
    plateau: {
      x,
      y: 0,
      width: parcel.width + 1.8,
      height: parcel.height + 1.8,
    },
    parcels: [{ rect: parcel, level: 1, nature }],
    lots,
    grids: [{ rect: grid, nature, base: slabTop(1) }],
  }
}

function city(...islands: IslandLayout[]): CityLayout {
  return { islands, bounds: { x: 0, y: 0, width: 200, height: 50 } }
}

function decorOf(layout: CityLayout) {
  return cityDecor(layout, islandShapes(layout))
}

const inLots = (trees: Tree[], layout: CityLayout) =>
  trees.filter((tree) => tree.z > layerAltitude(layout.islands[0]?.layer ?? 1))

describe('cityDecor', () => {
  it('keeps every tree of a lot inside it, crown included, and off the lots with a file', () => {
    const layout = city(island('a', 'normal'))
    const lots = layout.islands[0]?.lots ?? []
    const trees = inLots(decorOf(layout).trees, layout)
    expect(trees.length).toBeGreaterThan(0)
    for (const tree of trees) {
      const centreX = Math.floor((tree.x - 1.2) / 2) * 2 + 2.2
      const centreY = Math.floor((tree.y - 1.2) / 2) * 2 + 2.2
      const crown = CROWN_RADIUS[tree.kind] * tree.size
      expect(Math.abs(tree.x - centreX) + crown).toBeLessThanOrEqual(0.9 + 1e-9)
      expect(Math.abs(tree.y - centreY) + crown).toBeLessThanOrEqual(0.9 + 1e-9)
      expect(lots.some((lot) => lot.x === centreX && lot.y === centreY)).toBe(false)
      expect(tree.z).toBeCloseTo(layerAltitude(1) + slabTop(1))
    }
  })

  it('follows the ground: 2 trees an empty lot on a meadow, 2.5 in a park, none on concrete', () => {
    // 200 empty lots each, side by side
    const layout = city(
      island('meadow', 'normal'),
      island('park', 'tests', { x: 60 }),
      island('concrete', 'unanalyzed', { x: 120 }),
    )
    const trees = decorOf(layout).trees.filter((tree) => tree.z > layerAltitude(1))
    const on = (x0: number, x1: number) =>
      trees.filter((tree) => tree.x >= x0 && tree.x < x1).length / 200
    // A tree that finds no room in its lot is dropped: a little under the draw
    expect(on(0, 60)).toBeGreaterThan(1.75)
    expect(on(0, 60)).toBeLessThan(2.1)
    expect(on(60, 120)).toBeGreaterThan(2.15)
    expect(on(60, 120)).toBeLessThan(2.6)
    expect(on(120, 200)).toBe(0)
  })

  it('woods only a share of the empty lots past a budget of 16,000 trees', () => {
    // 9,900 empty lots: 19,800 trees expected, 16,000 kept
    const layout = city(island('huge', 'normal', { columns: 100, rows: 100, every: 100 }))
    const trees = decorOf(layout).trees.filter((tree) => tree.z > layerAltitude(1)).length
    expect(trees).toBeGreaterThan(14_500)
    expect(trees).toBeLessThan(16_500)
  })

  it('turns the empty lots of the island square into gardens, trees on them', () => {
    // The island folder's grid on the plateau: 4 × 2 lots, files on the west column
    const grid = { x: 1.2, y: 1.2, width: 8, height: 4 }
    const tiny: IslandLayout = {
      path: 'tiny',
      layer: 1,
      plateau: { x: 0, y: 0, width: 10.4, height: 6.6 },
      parcels: [],
      lots: [lot(2.2, 2.2), lot(2.2, 4.2)],
      square: { x: 0.9, y: 0.9, width: 8.6, height: 4.6 },
      grids: [{ rect: grid, nature: 'normal', base: 0, square: true }],
    }
    const decor = decorOf(city(tiny))
    // One garden over the three empty columns, inside their lots
    expect(decor.gardens).toEqual([
      { rect: { x: 3.4, y: 1.4, width: 5.6, height: 3.6 }, bottom: 0.6, top: 0.75 },
    ])
    // A city of two files: every garden lot is wooded, and no tree stands on the paving
    const onLots = decor.trees.filter((tree) => tree.z > layerAltitude(1))
    expect(onLots.length).toBeGreaterThanOrEqual(6 * 2)
    for (const tree of onLots) {
      expect(tree.x).toBeGreaterThan(3.2)
      expect(tree.z).toBeCloseTo(0.75)
    }
  })

  it('doubles the decor of a city under 50 files', () => {
    // Three small islands of one file, each alone or with a far one of 400 files
    const filler = island('filler', 'unanalyzed', { every: 1, x: 300 })
    const onSmall = <T extends { x: number }>(items: T[]) => items.filter((item) => item.x < 100)
    const lotTop = layerAltitude(3) + slabTop(1)
    let [rocksAlone, rocksAmong, treesAlone, treesAmong] = [0, 0, 0, 0]
    for (const path of ['a', 'b', 'c']) {
      const small = island(path, 'normal', { layer: 3, every: 1000 })
      const alone = decorOf(city(small))
      const among = decorOf(city(small, filler))
      rocksAlone += onSmall(alone.rocks).length
      rocksAmong += onSmall(among.rocks).length
      treesAlone += onSmall(alone.trees).filter((tree) => tree.z === lotTop).length
      treesAmong += onSmall(among.trees).filter((tree) => tree.z === lotTop).length
    }
    // Rocks on 44 % of the shore instead of 22 %
    expect(rocksAlone / rocksAmong).toBeGreaterThan(1.6)
    expect(rocksAlone / rocksAmong).toBeLessThan(2.4)
    // A tree more in each empty lot, 3 at most: 2 to 3 instead of 1 to 3 (399 empty lots each)
    expect(treesAlone / (3 * 399)).toBeGreaterThan(2.3)
    expect(treesAmong / (3 * 399)).toBeLessThan(2.1)
  })

  it('puts trees on the grass terraces, none on narrow ones, none on the beach', () => {
    const layout = city(island('high', 'unanalyzed', { layer: 4, every: 1 }))
    const shape = islandShapes(layout)[0]
    const decor = cityDecor(layout, islandShapes(layout))
    expect(shape).toBeDefined()
    const altitudes = shape?.altitudes ?? []
    const beach = altitudes.at(-1)
    expect(decor.trees.length).toBeGreaterThan(0)
    for (const tree of decor.trees) {
      // Concrete: every tree is on a flank, at the height of a terrace above the beach
      expect(altitudes.slice(1, -1)).toContain(tree.z)
      expect(tree.z).not.toBe(beach)
    }
    // Next to another island, terraces narrow to under 0.8 u: no tree faces it, away from the
    // corners, where they widen again toward the open sea
    const pair = city(
      island('west', 'unanalyzed', { layer: 4, every: 1 }),
      island('east', 'unanalyzed', { layer: 4, every: 1, x: 52.2 }),
    )
    const facing = cityDecor(pair, islandShapes(pair)).trees.filter(
      (tree) => tree.x > 42.4 && tree.x < 52.2 && tree.y > 10 && tree.y < 32,
    )
    expect(facing).toEqual([])
  })

  it('keeps trees and rocks clear of cascades', () => {
    // Two folders across a canal that pours over the south edge, at x = 21.8
    const parcel = (x: number) => ({
      rect: { x, y: 0.9, width: 20, height: 20 },
      level: 1,
      nature: 'unanalyzed' as const,
    })
    const layout = city({
      path: 'canal',
      layer: 4,
      plateau: { x: 0, y: 0, width: 43.6, height: 21.8 },
      parcels: [parcel(0.9), parcel(22.7)],
      lots: [],
    })
    const decor = decorOf(layout)
    expect(decor.trees.length + decor.rocks.length).toBeGreaterThan(0)
    for (const item of [...decor.trees, ...decor.rocks]) {
      expect(Math.abs(item.x - 21.8) < 1.2 && item.y < 0).toBe(false)
    }
  })

  it('gives the same decor to the same city', () => {
    const layout = city(island('a', 'normal', { layer: 3 }))
    expect(decorOf(layout)).toEqual(decorOf(layout))
  })
})

describe('decor models', () => {
  it('stay within their triangle budget', () => {
    expect(DECOR_MODELS.conifer.length / 3).toBe(6)
    // Two tiers with their tops and a four-sided trunk
    expect(DECOR_MODELS.round.length / 3).toBe(40)
    expect(DECOR_MODELS.rock.length / 3).toBe(5)
  })

  it('face outward and up', () => {
    for (const vertices of Object.values(DECOR_MODELS)) {
      for (let i = 0; i < vertices.length; i += 3) {
        const [a, b, c] = [vertices[i], vertices[i + 1], vertices[i + 2]]
        if (!a || !b || !c) {
          continue
        }
        const centroid = [0, 1, 2].map(
          (k) => (a.position[k] ?? 0) + (b.position[k] ?? 0) + (c.position[k] ?? 0),
        )
        const [nx, ny, nz] = a.normal
        // Sides point away from the axis, tops straight up
        const outward = nx * (centroid[0] ?? 0) + nz * (centroid[2] ?? 0)
        expect(outward > 1e-9 || ny > 0.99).toBe(true)
        // Wound counter-clockwise seen from outside, as three.js culls
        const u = [0, 1, 2].map((k) => (b.position[k] ?? 0) - (a.position[k] ?? 0))
        const v = [0, 1, 2].map((k) => (c.position[k] ?? 0) - (a.position[k] ?? 0))
        const cross = [
          (u[1] ?? 0) * (v[2] ?? 0) - (u[2] ?? 0) * (v[1] ?? 0),
          (u[2] ?? 0) * (v[0] ?? 0) - (u[0] ?? 0) * (v[2] ?? 0),
          (u[0] ?? 0) * (v[1] ?? 0) - (u[1] ?? 0) * (v[0] ?? 0),
        ]
        expect((cross[0] ?? 0) * nx + (cross[1] ?? 0) * ny + (cross[2] ?? 0) * nz).toBeGreaterThan(
          0,
        )
      }
    }
  })
})
