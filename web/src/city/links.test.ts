import { describe, expect, it } from 'vitest'
import { islandShapes } from './island-shape'
import {
  boundsOf,
  type CityLayout,
  type IslandLink,
  type Lot,
  type ParcelLayout,
  type Rect,
} from './layout'
import {
  boatsFor,
  type CityLinks,
  cityLinks,
  deckWidth,
  linkPairs,
  pointAlong,
  tipOf,
} from './links'
import { insidePolygon, landOutline } from './water-route'

interface Spec {
  plateau: Rect
  layer?: number
  parcels?: ParcelLayout[]
  files?: number
}

const FILE: Lot['file'] = { language: 'typescript', lines: 100, complexity: 5, test: false }

function city(specs: Spec[], links: IslandLink[]): CityLayout {
  const islands = specs.map(({ plateau, layer = 1, parcels = [], files = 60 }, index) => ({
    path: `island-${index}`,
    layer,
    plateau,
    parcels,
    lots: Array.from({ length: files }, () => ({ x: plateau.x + 1, y: plateau.y + 1, file: FILE })),
  }))
  return { islands, bounds: boundsOf(specs.map((spec) => spec.plateau)), links }
}

function linksOf(layout: CityLayout): CityLinks {
  return cityLinks(layout, islandShapes(layout))
}

const link = (from: number, to: number, imports: number, upward = 0): IslandLink => ({
  from,
  to,
  imports,
  upward,
})

describe('linkPairs', () => {
  it('joins both ways between two islands, the largest pair first', () => {
    const pairs = linkPairs([link(0, 1, 3), link(2, 0, 10), link(1, 0, 4, 1), link(1, 1, 50)])
    expect(pairs).toEqual([
      { a: 0, b: 2, imports: 10, upward: false },
      { a: 0, b: 1, imports: 7, upward: true },
    ])
  })
})

describe('deckWidth and boatsFor', () => {
  it('grow with the imports, a deck to 4.6 u at most', () => {
    expect(deckWidth(1)).toBeCloseTo(0.87, 2)
    expect(deckWidth(300)).toBeCloseTo(2.83, 2)
    expect(deckWidth(1e9)).toBe(4.6)
    expect([1, 9, 10, 99, 100, 5000].map(boatsFor)).toEqual([1, 1, 2, 2, 3, 4])
  })
})

describe('cityLinks', () => {
  const west = { x: 0, y: 0, width: 30, height: 20 }
  const east = { x: 42, y: 0, width: 30, height: 20 }

  it('bridges two neighbours of one layer with a flat deck, edge to edge', () => {
    const links = linksOf(city([{ plateau: west }, { plateau: east }], [link(0, 1, 30)]))
    expect(links.ferries).toHaveLength(0)
    expect(links.bridges).toHaveLength(1)
    const [bridge] = links.bridges
    expect(bridge).toMatchObject({ axis: 'x', low: 0, high: 1, start: 30, end: 42 })
    expect(bridge?.startZ).toBe(bridge?.endZ)
    expect(bridge?.width).toBeCloseTo(deckWidth(30))
  })

  it('ramps a bridge between islands one layer apart', () => {
    const links = linksOf(
      city(
        [
          { plateau: west, layer: 2 },
          { plateau: east, layer: 3 },
        ],
        [link(1, 0, 5)],
      ),
    )
    const [bridge] = links.bridges
    expect(bridge).toBeDefined()
    expect((bridge?.endZ ?? 0) - (bridge?.startZ ?? 0)).toBeCloseTo(0.45)
  })

  it('never bridges islands two layers apart: a ferry sails between them', () => {
    const links = linksOf(
      city(
        [
          { plateau: west, layer: 1 },
          { plateau: east, layer: 3 },
        ],
        [link(1, 0, 5)],
      ),
    )
    expect(links.bridges).toHaveLength(0)
    expect(links.ferries).toHaveLength(1)
  })

  it('never bridges over a third island, but beside one if there is room', () => {
    const across = (middle: Rect) =>
      linksOf(
        city(
          [
            { plateau: { x: 0, y: 0, width: 20, height: 60 } },
            { plateau: middle },
            { plateau: { x: 36, y: 0, width: 20, height: 60 } },
          ],
          [link(0, 2, 5)],
        ),
      )
    // All along the channel: a ferry
    const blocked = across({ x: 26, y: -10, width: 4, height: 80 })
    expect(blocked.bridges).toHaveLength(0)
    expect(blocked.ferries).toHaveLength(1)
    // In the middle of it only: the deck lands beside it, clear of its beach
    const beside = across({ x: 26, y: 25, width: 4, height: 10 })
    const [bridge] = beside.bridges
    expect(bridge).toBeDefined()
    expect(Math.abs((bridge?.at ?? 30) - 30)).toBeGreaterThan(5)
  })

  it('lands a deck 2 u at least from a canal that pours over the edge', () => {
    // Two folders 1.8 u apart: a canal along x, pouring over the east edge at y 9.1 to 10.9.
    const parcels: ParcelLayout[] = [
      { rect: { x: 4, y: 0.9, width: 25.1, height: 8.2 }, level: 1, nature: 'normal' },
      { rect: { x: 4, y: 10.9, width: 25.1, height: 8.2 }, level: 1, nature: 'normal' },
    ]
    const wide = city([{ plateau: west, parcels }, { plateau: east }], [link(0, 1, 30)])
    const shapes = islandShapes(wide)
    expect(shapes[0]?.canals.cells.some((cell) => cell.mouth === 'east')).toBe(true)
    const [bridge] = cityLinks(wide, shapes).bridges
    expect(bridge).toBeDefined()
    const half = (bridge?.width ?? 0) / 2
    const at = bridge?.at ?? 0
    expect(at + half <= 9.1 - 2 || at - half >= 10.9 + 2).toBe(true)

    // Facing only across the canal's mouth: no room to land, a ferry instead.
    const narrow = city(
      [{ plateau: west, parcels }, { plateau: { x: 42, y: 6, width: 30, height: 8 } }],
      [link(0, 1, 1)],
    )
    const links = linksOf(narrow)
    expect(links.bridges).toHaveLength(0)
    expect(links.ferries).toHaveLength(1)
  })

  it('lands three bridges on a side at most; the rest go to the port', () => {
    const neighbours = [0, 30, 60, 90].map((y) => ({
      plateau: { x: 32, y, width: 20, height: 20 },
    }))
    const links = linksOf(
      city(
        [{ plateau: { x: 0, y: 0, width: 20, height: 110 } }, ...neighbours],
        [1, 2, 3, 4].map((island) => link(island, 0, 50 - island)),
      ),
    )
    expect(links.bridges.map((bridge) => bridge.high)).toEqual([1, 2, 3])
    expect(links.ports).toEqual([expect.objectContaining({ island: 0, links: 1 })])
  })

  // A hub between six islands, far apart: no bridge, only ferries.
  const ring: Spec[] = [
    { plateau: { x: 100, y: 100, width: 20, height: 20 } },
    ...Array.from({ length: 6 }, (_, k) => ({
      plateau: { x: 40 * k, y: k % 2 === 0 ? 0 : 200, width: 16, height: 12 },
      layer: 3,
    })),
  ]

  it('sails four ferries from an island at most; the rest go to its port', () => {
    const links = linksOf(
      city(
        ring,
        [1, 2, 3, 4, 5, 6].map((island) => link(island, 0, 100 - island)),
      ),
    )
    expect(links.ferries).toHaveLength(4)
    expect(links.ferries.map((ferry) => ferry.b)).toEqual([1, 2, 3, 4])
    expect(links.ports).toEqual([expect.objectContaining({ island: 0, links: 2 })])
  })

  it('never hides nor gathers a link that goes up', () => {
    const links = linksOf(
      city(ring, [...[1, 2, 3, 4, 5].map((island) => link(island, 0, 100)), link(0, 6, 1, 1)]),
    )
    expect(links.ferries.some((ferry) => ferry.upward)).toBe(true)
    expect(links.ferries).toHaveLength(5)
  })

  it('hides links under 1 % of the largest', () => {
    const links = linksOf(city(ring, [link(1, 0, 1000), link(2, 0, 9), link(3, 0, 10)]))
    expect(links.hidden).toBe(1)
    expect(links.ferries.map((ferry) => ferry.imports)).toEqual([1000, 10])
  })

  it('draws every ferry by water, from pier to pier, with its boats', () => {
    const layout = city(ring, [link(1, 0, 1000), link(2, 0, 10), link(4, 0, 12)])
    const shapes = islandShapes(layout)
    const links = cityLinks(layout, shapes)
    const beaches = shapes.map((shape) => landOutline(shape))
    for (const ferry of links.ferries) {
      for (let i = 1; i < ferry.path.length; i++) {
        for (let k = 0; k <= 8; k++) {
          const { point } = pointAlong(ferry.path.slice(i - 1, i + 1), k / 8)
          expect(beaches.some((beach) => insidePolygon(point, beach))).toBe(false)
        }
      }
    }
    // Each pier's tip is where its line starts or ends.
    const tips = links.quays.map(tipOf)
    for (const ferry of links.ferries) {
      expect(tips).toContainEqual(ferry.path[0])
      expect(tips).toContainEqual(ferry.path.at(-1))
    }
    // One pier on each island, the hub's shared by its three lines; two boats at each pier, and
    // 4, 2 and 2 along the lines.
    expect(links.quays).toHaveLength(4)
    expect(links.boats).toHaveLength(2 * 4 + 4 + 2 + 2)
    expect(links.ferries.map((ferry) => ferry.pixels)).toEqual([
      5.9,
      1.4 + 4.5 * Math.sqrt(0.012),
      1.4 + 4.5 * Math.sqrt(0.01),
    ])
  })

  it('keeps each pier to its half of a narrow channel, without boats', () => {
    // West and East face each other across 9 u, each with a pier on that side.
    const links = linksOf(
      city(
        [
          { plateau: { x: 0, y: 0, width: 20, height: 20 }, layer: 1 },
          { plateau: { x: 29, y: 0, width: 20, height: 20 }, layer: 3 },
          { plateau: { x: 0, y: 80, width: 20, height: 20 }, layer: 5 },
        ],
        // West imports up (its east side), East imports down (its west side)
        [link(0, 2, 10, 10), link(1, 2, 10)],
      ),
    )
    const tip = (island: number) => {
      const quay = links.quays.find((q) => q.island === island && q.side !== 'south')
      return quay ? tipOf(quay) : null
    }
    expect(tip(0)?.x).toBeLessThan(24.5)
    expect(tip(1)?.x).toBeGreaterThan(24.5)
    // Too short to moor at: boats only along the two lines (and the far island's pier)
    const moored = links.boats.filter((boat) => boat.y < 22 && boat.x > 18 && boat.x < 31)
    expect(moored).toHaveLength(0)
  })

  it('sails links that go up on the east side, the others on the west', () => {
    const links = linksOf(city(ring, [link(1, 0, 10), link(0, 2, 10, 2)]))
    const sideOf = (island: number) =>
      links.quays.filter((quay) => quay.island === island).map((quay) => quay.side)
    expect(sideOf(1)).toEqual(['west'])
    expect(sideOf(2)).toEqual(['east'])
    expect(sideOf(0).sort()).toEqual(['east', 'west'])
  })

  it('gives a small city a quay and two boats, even without ferries', () => {
    const links = linksOf(city([{ plateau: west, files: 12 }], []))
    expect(links.quays).toHaveLength(1)
    expect(links.boats).toHaveLength(2)
    // A larger city without links has none
    expect(linksOf(city([{ plateau: west, files: 80 }], [])).quays).toHaveLength(0)
  })

  it('is the same from one call to the next', () => {
    const layout = city(
      ring,
      [1, 2, 3, 4, 5, 6].map((island) => link(island, 0, island * 7)),
    )
    expect(linksOf(layout)).toEqual(linksOf(layout))
  })
})
