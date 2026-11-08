import { describe, expect, it } from 'vitest'
import { folderWays } from './folder-link-marks'
import type { Bridge, Ferry } from './links'

// A bridge east-west across y = 5, from island 0 to island 1; a ferry from island 0 to island 2,
// along y = 0; another between islands 1 and 2.
const bridge: Bridge = {
  a: 0,
  b: 1,
  imports: 4,
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
const ferry = (a: number, b: number): Ferry => ({
  a,
  b,
  imports: 1,
  upward: false,
  path: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ],
})

describe('folderWays', () => {
  it('bands the deck of a linked bridge, side by side when it goes both ways', () => {
    const one = folderWays(0, new Map([[1, { outgoing: true, incoming: false }]]), [bridge], [])
    expect(one.bands.incoming).toEqual([])
    // Along the deck's centre line (board y 5 is three.js z −5), from bank to bank
    const [line] = one.bands.outgoing
    expect(line?.map((point) => point[2])).toEqual([-5, -5])
    expect(line?.[0]?.[0]).toBeLessThan(10)
    expect(line?.[1]?.[0]).toBeGreaterThan(20)

    const both = folderWays(1, new Map([[0, { outgoing: true, incoming: true }]]), [bridge], [])
    expect(both.bands.outgoing[0]?.[0]?.[2]).toBeCloseTo(-5 + 0.22 * 2)
    expect(both.bands.incoming[0]?.[0]?.[2]).toBeCloseTo(-5 - 0.22 * 2)
  })

  it('lines the route of a linked ferry, and leaves the others', () => {
    const ways = folderWays(
      0,
      new Map([[2, { outgoing: false, incoming: true }]]),
      [bridge],
      [ferry(0, 2), ferry(1, 2)],
    )
    expect(ways.bands.outgoing).toEqual([])
    expect(ways.ferries.outgoing).toEqual([])
    expect(ways.ferries.incoming).toHaveLength(1)
    expect(ways.ferries.incoming[0]?.map((point) => point[0])).toEqual([0, 10])
  })
})
