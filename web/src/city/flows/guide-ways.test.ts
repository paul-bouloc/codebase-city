import { describe, expect, it } from 'vitest'
import type { Bridge, Ferry, Pair, Port, Quay } from '../waterways/links'
import type { CityLayout, IslandLink } from '../world/layout'
import type { ExtraFerries } from './extra-ferries'
import { alongPath, chevrons, guideWays, nearestImporter } from './guide-ways'

// Islands 0 to 3 along the x axis, 20 u apart; island 4 far off.
const at = (x: number, y = 0) => ({ plateau: { x, y, width: 10, height: 10 } })
const islands = [at(0), at(20), at(40), at(60), at(0, 200)]
const link = (from: number, to: number, imports = 1): IslandLink => ({
  from,
  to,
  imports,
  upward: 0,
})
const layout = (links: IslandLink[]) => ({ islands, links }) as unknown as CityLayout

const BRIDGE: Bridge = {
  a: 0,
  b: 1,
  imports: 10,
  upward: false,
  axis: 'x',
  low: 0,
  high: 1,
  at: 5,
  start: 10,
  end: 20,
  startZ: 1,
  endZ: 1,
  width: 2,
}
const FERRY: Ferry = {
  a: 1,
  b: 2,
  imports: 4,
  upward: false,
  path: [
    { x: 30, y: 5 },
    { x: 40, y: 5 },
  ],
}
const NOTHING = { bridges: [], ferries: [], unshown: [], ports: [], extra: undefined }

describe('guide ways', () => {
  it('starts from the nearest island of a unit that imports the other end', () => {
    const city = layout([link(0, 3), link(2, 3), link(1, 3, 0), link(4, 3)])
    expect(nearestImporter({ from: [0, 1, 2, 4], to: 3 }, city)).toBe(2)
    // An island the other end imports, not the reverse, is no start
    expect(nearestImporter({ from: [0], to: 2 }, layout([link(2, 0)]))).toBeNull()
  })

  it('takes the bridge or the ferry line, from the importer to the imported', () => {
    const city = layout([link(1, 0), link(1, 2)])
    const ways = guideWays(
      [
        { from: [1], to: 0 },
        { from: [1], to: 2 },
      ],
      city,
      { ...NOTHING, bridges: [BRIDGE], ferries: [FERRY] },
    )
    expect(ways.map((way) => [way.link, way.kind, way.fromPort])).toEqual([
      [0, 'bridge', null],
      [1, 'ferry', null],
    ])
    // The bridge runs from island 0 to 1: reversed, from 1 to 0
    expect(ways[0]?.path[0]?.[0]).toBeGreaterThan(ways[0]?.path[1]?.[0] ?? 0)
    expect(ways[1]?.path.map((point) => point[0])).toEqual([30, 40])
  })

  it('sails out a link a port gathers, and says so; none without a way', () => {
    const pair: Pair = { a: 2, b: 3, imports: 1, upward: false }
    const port = { island: 3, pairs: [pair], quay: {} as Quay } satisfies Port
    const routes: unknown[] = []
    const extra = {
      route: (asked: Pair, from?: unknown) => {
        routes.push(from)
        return {
          ...asked,
          path: [
            { x: 50, y: 5 },
            { x: 45, y: 5 },
          ],
        }
      },
    } as unknown as ExtraFerries
    const city = layout([link(2, 3)])
    const ways = guideWays([{ from: [2], to: 3 }], city, {
      ...NOTHING,
      unshown: [pair],
      ports: [port],
      extra,
    })
    expect(routes).toEqual([port])
    expect(ways[0]?.fromPort).toBe(pair)
    expect(ways[0]?.path.map((point) => point[0])).toEqual([50, 45])
    expect(guideWays([{ from: [2], to: 3 }], city, NOTHING)).toEqual([])
  })

  it('finds a point along a way, and points its chevrons to its end', () => {
    const path: [number, number, number][] = [
      [0, 0, 1],
      [10, 0, 1],
      [10, 10, 1],
    ]
    expect(alongPath(path, 0.5)).toEqual({ at: [10, 0, 1], dx: 1, dy: 0 })
    expect(alongPath(path, 0.75)).toMatchObject({ at: [10, 5, 1], dx: 0, dy: 1 })
    const [first] = chevrons(path)
    // At 30 %: x = 6, its branches behind it, either side of the way
    expect(first?.[1]).toEqual([6, 0, 1])
    const [left, , right] = first ?? []
    expect(left?.[0]).toBeLessThan(6)
    expect(right?.[0]).toBeLessThan(6)
    expect(Math.sign(left?.[1] ?? 0)).toBe(-Math.sign(right?.[1] ?? 0))
  })
})
