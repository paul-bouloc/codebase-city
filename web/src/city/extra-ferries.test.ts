import { describe, expect, it } from 'vitest'
import { ExtraFerries, islandExtras } from './extra-ferries'
import { islandShapes } from './island-shape'
import { boundsOf, type CityLayout, type IslandLink, type Lot, type Rect } from './layout'
import { cityLinks, pointAlong, tipOf } from './links'
import { insidePolygon, landOutline } from './water-route'

const FILE: Lot['file'] = { language: 'typescript', lines: 100, complexity: 5, test: false }

function city(plateaux: Rect[], links: IslandLink[]): CityLayout {
  const islands = plateaux.map((plateau, index) => ({
    path: `island-${index}`,
    layer: index === 0 ? 1 : 3,
    plateau,
    parcels: [],
    lots: Array.from({ length: 60 }, () => ({ x: plateau.x + 1, y: plateau.y + 1, file: FILE })),
  }))
  return { islands, bounds: boundsOf(plateaux), links }
}

// A hub between six islands, far apart: no bridge, only ferries; two go to its port, and one
// link is too small to draw.
const RING: Rect[] = [
  { x: 100, y: 100, width: 20, height: 20 },
  ...Array.from({ length: 6 }, (_, k) => ({
    x: 40 * k,
    y: k % 2 === 0 ? 0 : 200,
    width: 16,
    height: 12,
  })),
]
const LINKS: IslandLink[] = [
  ...[1, 2, 3, 4, 5].map((island) => ({ from: island, to: 0, imports: 1000 - island, upward: 0 })),
  { from: 0, to: 6, imports: 3, upward: 0 },
]

function setUp() {
  const layout = city(RING, LINKS)
  const shapes = islandShapes(layout)
  const links = cityLinks(layout, shapes)
  return { layout, shapes, links, extra: new ExtraFerries(layout, shapes, links) }
}

describe('extra ferries', () => {
  it('sails a port’s links out of its quay, by water, to the other island’s beach', () => {
    const { shapes, links, extra } = setUp()
    const port = links.ports[0]
    expect(port?.pairs.map((pair) => pair.b)).toEqual([5])
    const pair = port?.pairs[0]
    if (!port || !pair) {
      throw new Error('no port')
    }
    const ferry = extra.route(pair, port)
    expect(ferry?.path[0]).toEqual(tipOf(port.quay))
    const beaches = shapes.map((shape) => landOutline(shape))
    const path = ferry?.path ?? []
    // Off the land all the way, but for its last step up the other island's beach.
    for (let i = 1; i < path.length - 1; i++) {
      for (let k = 0; k <= 8; k++) {
        const { point } = pointAlong(path.slice(i - 1, i + 1), k / 8)
        expect(beaches.some((beach) => insidePolygon(point, beach))).toBe(false)
      }
    }
    expect(insidePolygon(path.at(-1) ?? { x: 0, y: 0 }, beaches[5] ?? [])).toBe(true)
  })

  it('runs from a to b, as every ferry does, from whichever island it leaves', () => {
    const { layout, links, extra } = setUp()
    const small = links.unshown.find((pair) => pair.b === 6)
    if (!small) {
      throw new Error('no small link')
    }
    const ferry = extra.route(small)
    const near = (point: { x: number; y: number } | undefined, island: number) => {
      const plateau = layout.islands[island]?.plateau as Rect
      const cx = plateau.x + plateau.width / 2
      const cy = plateau.y + plateau.height / 2
      return Math.hypot((point?.x ?? 0) - cx, (point?.y ?? 0) - cy)
    }
    const path = ferry?.path ?? []
    expect(near(path[0], 0)).toBeLessThan(near(path[0], 6))
    expect(near(path.at(-1), 6)).toBeLessThan(near(path.at(-1), 0))
  })

  it('routes a line once and leaves the water as it found it', () => {
    const { links, extra } = setUp()
    const traffic = Float32Array.from(links.grid?.traffic ?? [])
    const pair = links.unshown[0]
    if (!pair) {
      throw new Error('no unshown link')
    }
    const first = extra.route(pair)
    expect(extra.route(pair)).toBe(first)
    expect(links.grid?.traffic).toEqual(traffic)
  })

  it('sails every undrawn link of an island, at its port or too small', () => {
    const { links, extra } = setUp()
    expect(islandExtras(0, links.unshown, extra).map((ferry) => ferry.b)).toEqual([5, 6])
    expect(islandExtras(6, links.unshown, extra).map((ferry) => ferry.a)).toEqual([0])
    expect(islandExtras(1, links.unshown, extra)).toEqual([])
  })
})
