import { describe, expect, it } from 'vitest'
import { folderFlows } from './folder-links'
import type { CityLayout, IslandLayout, Point } from './layout'

function island(lots: Point[]): IslandLayout {
  return {
    path: 'src',
    layer: 1,
    plateau: { x: 0, y: 0, width: 10, height: 10 },
    parcels: [],
    lots: lots.map(({ x, y }) => ({
      x,
      y,
      file: { language: 'go', lines: 10, complexity: 1, test: false },
    })),
    grids: [{ rect: { x: 0, y: 5, width: 10, height: 5 }, nature: 'normal', base: 0 }],
  }
}

// Island 0 has a south half (y < 5) and a north half; islands 1, 2 and 3 import or are imported.
const LAYOUT: CityLayout = {
  islands: [
    island([
      { x: 2, y: 2 },
      { x: 2, y: 8 },
    ]),
    island([{ x: 2, y: 2 }]),
    island([{ x: 2, y: 2 }]),
    island([{ x: 2, y: 2 }]),
  ],
  bounds: { x: 0, y: 0, width: 10, height: 10 },
  links: [
    { from: 0, to: 1, imports: 2, upward: 0 },
    { from: 2, to: 0, imports: 1, upward: 0 },
    { from: 0, to: 2, imports: 1, upward: 0 },
    { from: 3, to: 0, imports: 1, upward: 0 },
  ],
  imports: [
    // The south file imports island 1 and island 2's file; island 2's file imports the north
    // file; island 3 imports the north folder as a package.
    { from: { island: 0, lot: 0 }, to: { island: 1, lot: 0 }, upward: false },
    { from: { island: 0, lot: 0 }, to: { island: 2, lot: 0 }, upward: false },
    { from: { island: 2, lot: 0 }, to: { island: 0, lot: 1 }, upward: false },
    { from: { island: 3, lot: 0 }, to: { island: 0, grid: 0 }, upward: false },
    // Within the island: no other island to light up
    { from: { island: 0, lot: 1 }, to: { island: 0, lot: 0 }, upward: false },
  ],
}

describe('folderFlows', () => {
  it('links an island with the islands it imports and those that import it', () => {
    expect(folderFlows(LAYOUT, { island: 0 })).toEqual(
      new Map([
        [1, { outgoing: true, incoming: false }],
        [2, { outgoing: true, incoming: true }],
        [3, { outgoing: false, incoming: true }],
      ]),
    )
  })

  it('links a parcel by the imports of its own files', () => {
    const south = { x: 0, y: 0, width: 10, height: 5 }
    const north = { x: 0, y: 5, width: 10, height: 5 }
    expect(folderFlows(LAYOUT, { island: 0, rect: south })).toEqual(
      new Map([
        [1, { outgoing: true, incoming: false }],
        [2, { outgoing: true, incoming: false }],
      ]),
    )
    expect(folderFlows(LAYOUT, { island: 0, rect: north })).toEqual(
      new Map([
        [2, { outgoing: false, incoming: true }],
        [3, { outgoing: false, incoming: true }],
      ]),
    )
  })
})
