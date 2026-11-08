import { describe, expect, it } from 'vitest'
import { type IslandShape, islandShapes } from './island-shape'
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
  quayAt,
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

  it("counts a link gathered at both its islands' ports once", () => {
    // Two hubs with four ferries each, then a link between them: both are full.
    const spread = (k: number) => ({ plateau: { x: 50 * k, y: 0, width: 16, height: 12 } })
    const links = linksOf(
      city(
        Array.from({ length: 10 }, (_, k) => spread(k)),
        [
          ...[2, 3, 4, 5].map((island) => link(0, island, 100)),
          ...[6, 7, 8, 9].map((island) => link(1, island, 100)),
          link(0, 1, 50),
        ],
      ),
    )
    expect(links.ports.map((port) => [port.island, port.links])).toEqual([
      [0, 1],
      [1, 1],
    ])
    expect(links.inPorts).toBe(1)
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
    // A pier on each spoke, two on the hub (one toward the south spokes, one toward the north
    // one); two boats at each pier, and 4, 2 and 2 along the lines.
    expect(links.quays).toHaveLength(5)
    expect(links.boats).toHaveLength(2 * 5 + 4 + 2 + 2)
    // The largest first.
    const imports = links.ferries.map((ferry) => ferry.imports)
    expect(imports).toEqual([...imports].sort((x, y) => y - x))
  })

  it('keeps a pier to its half of a narrow channel, too short to moor at', () => {
    // Two plateaux 7 u apart
    const layout = city(
      [
        { plateau: { x: 0, y: 0, width: 20, height: 20 } },
        { plateau: { x: 27, y: 0, width: 20, height: 20 } },
      ],
      [],
    )
    const shape = islandShapes(layout)[0] as IslandShape
    const plateaux = layout.islands.map((island) => island.plateau)
    const narrow = quayAt(shape, 0, 'east', 0.5, false, plateaux)
    expect(tipOf(narrow).x).toBeLessThan(23.5)
    expect(narrow.length - 0.8).toBeLessThan(2)
    // On the open sea, a whole pier
    expect(quayAt(shape, 0, 'west', 0.5, false, plateaux).length).toBeCloseTo(0.8 + 2.4)
  })

  it('keeps a pier 2 u off the deck of a bridge on its side', () => {
    // The middle island looks out the farthest to the west, where its bridge lands too.
    const links = linksOf(
      city(
        [
          { plateau: { x: 0, y: 0, width: 30, height: 20 } },
          { plateau: { x: 50, y: 0, width: 30, height: 20 } },
          { plateau: { x: 90, y: 0, width: 20, height: 20 } },
          { plateau: { x: 50, y: 30, width: 30, height: 10 } },
          { plateau: { x: 50, y: -20, width: 30, height: 10 } },
          { plateau: { x: -300, y: 0, width: 20, height: 20 } },
        ],
        [link(0, 1, 30), link(1, 5, 10)],
      ),
    )
    const [bridge] = links.bridges
    const pier = links.quays.find((quay) => quay.island === 1)
    expect(bridge).toMatchObject({ low: 0, high: 1 })
    expect(pier?.side).toBe('west')
    const gap = Math.abs((pier?.y ?? 0) - (bridge?.at ?? 0)) - (bridge?.width ?? 0) / 2 - 0.3
    expect(gap).toBeGreaterThanOrEqual(2 - 1e-9)
  })

  it('keeps a pier 2 u off every mouth of its side, and on its side', () => {
    // Three folders 1.8 u apart: two canals pouring over the west edge, at 4.1 to 5.9 and
    // 9.1 to 10.9, on a side 14 u long.
    const parcels: ParcelLayout[] = [0.9, 5.9, 10.9].map((y, k) => ({
      rect: { x: 0.9, y, width: 20, height: k === 2 ? 2.2 : 3.2 },
      level: 1,
      nature: 'normal',
    }))
    const layout = city(
      [
        { plateau: { x: 0, y: 0, width: 30, height: 14 }, parcels },
        { plateau: { x: -200, y: 0, width: 20, height: 20 } },
      ],
      [link(0, 1, 10)],
    )
    const shapes = islandShapes(layout)
    const mouths = (shapes[0]?.canals.cells ?? [])
      .filter((cell) => cell.mouth === 'west')
      .map((cell) => [cell.rect.y, cell.rect.y + cell.rect.height])
    expect(mouths).toHaveLength(2)
    const pier = cityLinks(layout, shapes).quays.find((quay) => quay.island === 0)
    const y = pier?.y ?? 0
    expect(y).toBeGreaterThanOrEqual(0.3)
    expect(y).toBeLessThanOrEqual(13.7)
    // Room is left at the side's south end: 2 u clear of both
    for (const [m0 = 0, m1 = 0] of mouths) {
      expect(y + 0.3 <= m0 - 2 + 1e-9 || y - 0.3 >= m1 + 2 - 1e-9).toBe(true)
    }
  })

  it('leaves no pier for a ferry with no way by water', () => {
    // A lagoon: four islands 1 u apart, whose shores close it, around a fifth.
    const links = linksOf(
      city(
        [
          { plateau: { x: 0, y: 0, width: 60, height: 12 } },
          { plateau: { x: 0, y: 48, width: 60, height: 12 } },
          { plateau: { x: 0, y: 13, width: 12, height: 34 } },
          { plateau: { x: 48, y: 13, width: 12, height: 34 } },
          { plateau: { x: 24, y: 24, width: 12, height: 12 } },
          { plateau: { x: 150, y: 0, width: 20, height: 20 } },
        ],
        [link(4, 5, 10)],
      ),
    )
    expect(links.ferries).toHaveLength(0)
    expect(links.hidden).toBe(1)
    expect(links.quays).toHaveLength(0)
    expect(links.boats).toHaveLength(0)
  })

  it('leaves each island from the side turned toward the other', () => {
    // Spoke 1 stands south-west of the hub, spoke 4 north of it
    const links = linksOf(city(ring, [link(1, 0, 10), link(0, 4, 10)]))
    const sideOf = (island: number) => links.quays.find((quay) => quay.island === island)?.side
    expect(sideOf(1)).toBe('north')
    expect(sideOf(4)).toBe('south')
  })

  it('gives an island a pier on each side its ferries leave from', () => {
    // Spokes 1 and 3 south of the hub, spoke 2 north of it
    const links = linksOf(city(ring, [link(1, 0, 10), link(2, 0, 10), link(3, 0, 10)]))
    const hub = links.quays.filter((quay) => quay.island === 0).map((quay) => quay.side)
    expect(new Set(hub).size).toBeGreaterThan(1)
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
