import { describe, expect, it } from 'vitest'
import { cycleWays, loopIslandPairs } from './cycle-ways'
import type { ExtraFerries } from './extra-ferries'
import type { Bridge, Ferry, Pair } from './waterways/links'

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
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ],
}

describe('cycle ways', () => {
  it('finds the pairs of islands a loop runs between, back to its start, each once', () => {
    const islands = [0, 0, 1, 2]
    const islandOf = (building: number) => islands[building]
    expect(loopIslandPairs([0, 1, 2, 3], islandOf)).toEqual([
      [0, 1],
      [1, 2],
      [0, 2],
    ])
    // Two files of one island and back: no way between islands.
    expect(loopIslandPairs([0, 1], islandOf)).toEqual([])
    // There and back between two islands: one pair.
    expect(loopIslandPairs([1, 2], islandOf)).toEqual([[0, 1]])
  })

  it('outlines both edges of a bridge and the line of a ferry, nothing else', () => {
    const ways = cycleWays([[0, 1]], [BRIDGE], [FERRY], [], undefined)
    expect(ways.edges).toHaveLength(2)
    // Each edge runs along the deck, one either side of its middle line (y = 5, three.js −z).
    const [left, right] = ways.edges.map((edge) => edge[0]?.[2])
    expect([left, right].map((z) => Math.abs((z ?? 0) + 5))).toEqual([1, 1])
    expect(ways.ferries).toEqual([])
    expect(cycleWays([[1, 2]], [BRIDGE], [FERRY], [], undefined).ferries).toHaveLength(1)
  })

  it('sails out a link the city leaves undrawn', () => {
    const pair: Pair = { a: 2, b: 3, imports: 1, upward: false }
    const routed: Pair[] = []
    const extra = {
      route: (asked: Pair) => {
        routed.push(asked)
        return { ...asked, path: FERRY.path }
      },
    } as unknown as ExtraFerries
    const ways = cycleWays([[2, 3]], [BRIDGE], [FERRY], [pair], extra)
    expect(routed).toEqual([pair])
    expect(ways.ferries).toHaveLength(1)
  })
})
