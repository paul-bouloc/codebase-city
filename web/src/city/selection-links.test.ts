import { describe, expect, it } from 'vitest'
import type { CityLayout, FileImport, IslandLayout, Lot } from './layout'
import {
  indexImports,
  type LinkEnd,
  linkedBuildings,
  markedBuildings,
  OPENED_ARCS,
  openBundle,
  SINGLE_ARCS,
  selectionLinks,
} from './selection-links'

const FILE = { language: 'typescript', lines: 10, complexity: 1, test: false } as const

function island(lots: number, x = 0): IslandLayout {
  return {
    path: `island-${x}`,
    layer: 1,
    plateau: { x, y: 0, width: 100, height: 100 },
    parcels: [],
    lots: Array.from(
      { length: lots },
      (_, index): Lot => ({ x: x + 1 + 2 * index, y: 1, file: FILE }),
    ),
    grids: [{ rect: { x, y: 0, width: 4, height: 2 }, nature: 'normal', base: 0 }],
  }
}

function city(islands: IslandLayout[], imports: FileImport[]): CityLayout {
  return { islands, bounds: { x: 0, y: 0, width: 1000, height: 100 }, imports }
}

const at = (island: number, lot: number) => ({ island, lot })

describe('indexImports', () => {
  it('indexes imports both ways, by building', () => {
    // Island 0: buildings 0 and 1; island 1: buildings 2, 3 and 4
    const layout = city(
      [island(2), island(3, 500)],
      [
        { from: at(0, 0), to: at(1, 2), upward: true },
        { from: at(1, 0), to: at(0, 0), upward: false },
      ],
    )
    const index = indexImports(layout)
    expect(index.outgoing[0]).toEqual([{ end: { building: 4 }, island: 1, upward: true }])
    expect(index.incoming[4]).toEqual([{ end: { building: 0 }, island: 0, upward: true }])
    expect(index.incoming[0]).toEqual([{ end: { building: 2 }, island: 1, upward: false }])
    expect(index.outgoing[1]).toEqual([])
  })

  it('lets an import of a folder reach each file of its grid, once', () => {
    // The grid of island 1 holds its first two lots (x 501 and 503), not the third (x 505)
    const layout = city(
      [island(1), island(3, 500)],
      [
        { from: at(0, 0), to: { island: 1, grid: 0 }, upward: false },
        { from: at(0, 0), to: at(1, 0), upward: false },
      ],
    )
    const index = indexImports(layout)
    expect(index.outgoing[0]?.[0]?.end).toEqual({ island: 1, grid: 0 })
    expect(index.incoming[1]).toHaveLength(1)
    expect(index.incoming[2]).toHaveLength(1)
    expect(index.incoming[3]).toEqual([])
    // The files of an imported folder are linked to the file that imports it
    const links = selectionLinks(index, 0, () => 0)
    expect([...linkedBuildings(links, index)].sort()).toEqual([1, 2])
  })
})

describe('selectionLinks', () => {
  // Building 0 imports every other building: 30 on island 0, then 30 on island 1.
  const many = (upward: (lot: number) => boolean) =>
    city(
      [island(31), island(30, 500)],
      [
        ...Array.from({ length: 30 }, (_, lot) => ({
          from: at(0, 0),
          to: at(0, lot + 1),
          upward: false,
        })),
        ...Array.from({ length: 30 }, (_, lot) => ({
          from: at(0, 0),
          to: at(1, lot),
          upward: upward(lot),
        })),
      ],
    )
  // Distance by building index: the further down the list, the further away.
  const distance = (end: LinkEnd) => ('building' in end ? end.building : 0)

  it('gives the nearest their own arc, and bundles the others by island', () => {
    const links = selectionLinks(indexImports(many(() => false)), 0, distance)
    const { single, bundles } = links.outgoing
    expect(single).toHaveLength(SINGLE_ARCS)
    expect(single.map((link) => link.end)).toEqual(
      Array.from({ length: SINGLE_ARCS }, (_, index) => ({ building: index + 1 })),
    )
    expect(bundles.map((bundle) => [bundle.island, bundle.ends.length])).toEqual([
      [0, 10],
      [1, 30],
    ])
    expect(links.incoming).toEqual({ single: [], bundles: [] })
  })

  it('never bundles an import up the layers', () => {
    // The two furthest buildings are on a higher layer
    const links = selectionLinks(indexImports(many((lot) => lot >= 28)), 0, distance)
    const { single, bundles } = links.outgoing
    expect(single).toHaveLength(SINGLE_ARCS + 2)
    expect(single.filter((link) => link.upward).map((link) => link.end)).toEqual([
      { building: 59 },
      { building: 60 },
    ])
    expect(bundles.find((bundle) => bundle.island === 1)?.ends).toHaveLength(28)
  })

  it('opens a bundle into its nearest arcs', () => {
    const links = selectionLinks(indexImports(many(() => false)), 0, distance)
    const bundle = links.outgoing.bundles[1]
    if (!bundle) {
      throw new Error('no bundle')
    }
    const opened = openBundle(links, bundle)
    expect(opened.outgoing.single).toHaveLength(SINGLE_ARCS + 30)
    expect(opened.outgoing.bundles).toHaveLength(1)
    expect(OPENED_ARCS).toBeGreaterThan(30)
    // A bundle larger than an opening keeps the rest
    const big = { ...bundle, ends: [...bundle.ends, ...bundle.ends] }
    const half = openBundle({ ...links, outgoing: { single: [], bundles: [big] } }, big)
    expect(half.outgoing.single).toHaveLength(OPENED_ARCS)
    expect(half.outgoing.bundles[0]?.ends).toHaveLength(60 - OPENED_ARCS)
    expect(half.outgoing.bundles[0]?.shown).toBe(OPENED_ARCS)
  })

  it('marks a building linked both ways as imported', () => {
    const layout = city(
      [island(3)],
      [
        { from: at(0, 0), to: at(0, 1), upward: false },
        { from: at(0, 1), to: at(0, 0), upward: false },
        { from: at(0, 2), to: at(0, 0), upward: false },
      ],
    )
    const links = selectionLinks(indexImports(layout), 0, distance)
    expect([...markedBuildings(links)]).toEqual([
      [1, 'outgoing'],
      [2, 'incoming'],
    ])
    expect([...linkedBuildings(links, indexImports(layout))].sort()).toEqual([1, 2])
  })
})
