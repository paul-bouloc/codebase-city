import { describe, expect, it } from 'vitest'
import type { CityLayout, IslandLayout, ParcelLayout } from '../world/layout'
import { layerAltitude, slabTop } from '../world/units'
import {
  LABEL_GAP,
  type LabelCandidate,
  labelAreas,
  MAX_ISLAND_LABELS,
  MAX_LABELS,
  MAX_PARCEL_LABELS,
  placeLabels,
} from './label-placement'

function island(
  path: string,
  x: number,
  width: number,
  parcels: ParcelLayout[] = [],
  layer = 1,
): IslandLayout {
  return { path, layer, plateau: { x, y: 0, width, height: 20 }, parcels, lots: [] }
}

function city(islands: IslandLayout[]): CityLayout {
  const left = Math.min(...islands.map((each) => each.plateau.x))
  const right = Math.max(...islands.map((each) => each.plateau.x + each.plateau.width))
  return { islands, bounds: { x: left, y: 0, width: right - left, height: 20 } }
}

function candidate(overrides: Partial<LabelCandidate> = {}): LabelCandidate {
  return {
    island: true,
    span: 100,
    selected: false,
    shown: false,
    x: 0,
    y: 0,
    width: 40,
    height: 20,
    ...overrides,
  }
}

describe('labelAreas', () => {
  it('stands an island’s label west of it, at the water', () => {
    const [west, east] = labelAreas(city([island('a', 0, 30), island('b', 50, 30)]))
    expect(west?.path).toBe('a')
    expect(west?.anchor[0]).toBeLessThan(0)
    expect(west?.anchor[1]).toBe(0)
    // Board y runs to three.js −z: the label is level with the plateau's middle.
    expect(west?.anchor[2]).toBe(-10)
    expect(west?.extent).toBe(30)
    // The island on the city's east edge has its label east of it, on the open sea.
    expect(east?.anchor[0]).toBeGreaterThan(80)
  })

  it('stands the label of an island between two others on the open sea south of it', () => {
    const middle = labelAreas(
      city([island('a', 0, 30), island('b', 40, 30), island('c', 80, 30)]),
    )[1]
    // South of the plateau's middle (board y below 0 is three.js z above 0), at the water.
    expect(middle?.anchor[0]).toBe(55)
    expect(middle?.anchor[2]).toBeGreaterThan(0)
  })

  it('stands the label of an island hemmed in on the side with the most water', () => {
    const at = (path: string, x: number, y: number) => ({
      ...island(path, x, 20),
      plateau: { x, y, width: 20, height: 20 },
    })
    const areas = labelAreas(
      city([
        at('centre', 0, 0),
        at('west', -30, 0),
        at('east', 26, 0),
        at('south', 0, -28),
        at('north', 0, 24),
      ]),
    )
    // 10 u of water west, 6 east, 8 south, 4 north: west.
    expect(areas[0]?.anchor[0]).toBeLessThan(0)
    expect(areas[0]?.anchor[2]).toBe(-10)
  })

  it('keeps a lone island’s label west of it', () => {
    const [only] = labelAreas(city([island('a', 0, 30)]))
    expect(only?.anchor[0]).toBeLessThan(0)
  })

  it('labels a folder over the middle of its slab, but not a park of tests', () => {
    const parcels: ParcelLayout[] = [
      { rect: { x: 2, y: 2, width: 10, height: 6 }, path: 'a/src', level: 1, nature: 'normal' },
      { rect: { x: 14, y: 2, width: 4, height: 4 }, path: 'a/test', level: 1, nature: 'tests' },
      { rect: { x: 2, y: 10, width: 4, height: 4 }, level: 2, nature: 'normal' },
    ]
    const areas = labelAreas(city([island('a', 0, 30, parcels, 3)]))
    expect(areas.map((area) => area.path)).toEqual(['a', 'a/src'])
    const folder = areas[1]
    expect(folder?.target).toEqual({ kind: 'parcel', island: 0, parcel: 0 })
    expect(folder?.anchor[0]).toBe(7)
    expect(folder?.anchor[1]).toBeCloseTo(layerAltitude(3) + slabTop(1) + 0.3)
    expect(folder?.anchor[2]).toBe(-5)
    expect(folder?.extent).toBe(10)
  })
})

describe('placeLabels', () => {
  it('drops a label whose box meets one before it, the larger winning', () => {
    const shown = placeLabels([
      candidate({ span: 80, x: 10 }),
      candidate({ span: 200, x: 30 }),
      candidate({ span: 50, x: 200 }),
    ])
    expect(shown).toEqual([false, true, true])
  })

  it('puts the selected folder first, then islands before folders', () => {
    const shown = placeLabels([
      candidate({ span: 900 }),
      candidate({ island: false, span: 50, selected: true }),
      candidate({ island: false, span: 5000, x: 200 }),
      candidate({ span: 10, x: 200 }),
    ])
    expect(shown).toEqual([false, true, false, true])
  })

  it('lets a newcomer in only clear of the others by the gap; one on show only if it meets none', () => {
    const near = { x: 40 + LABEL_GAP - 1 }
    expect(placeLabels([candidate({ span: 900 }), candidate(near)])).toEqual([true, false])
    expect(placeLabels([candidate({ span: 900 }), candidate({ ...near, shown: true })])).toEqual([
      true,
      true,
    ])
    // Importance still decides: a larger newcomer that meets one on show takes its place.
    expect(placeLabels([candidate({ span: 900 }), candidate({ span: 50, shown: true })])).toEqual([
      true,
      false,
    ])
  })

  it('brings a newcomer only when it is ready', () => {
    const labels = [candidate({ span: 900 }), candidate({ x: 200, shown: true })]
    expect(placeLabels(labels, { ready: () => false })).toEqual([false, true])
    expect(placeLabels(labels, { ready: () => true })).toEqual([true, true])
  })

  it('keeps a label on show over one before it while it is tolerated', () => {
    const labels = [candidate({ span: 900 }), candidate({ span: 50, shown: true })]
    expect(placeLabels(labels, { tolerated: () => true })).toEqual([true, true])
    expect(placeLabels(labels, { tolerated: () => false })).toEqual([true, false])
  })

  it('keeps to the caps of islands, folders and both', () => {
    const spread = (count: number, island: boolean, row: number) =>
      Array.from({ length: count }, (_, at) => candidate({ island, x: at * 60, y: row * 60 }))
    const islands = placeLabels(spread(30, true, 0)).filter(Boolean).length
    expect(islands).toBe(MAX_ISLAND_LABELS)
    const parcels = placeLabels(spread(40, false, 0)).filter(Boolean).length
    expect(parcels).toBe(MAX_PARCEL_LABELS)
    const both = placeLabels([...spread(30, true, 0), ...spread(40, false, 1)])
    expect(both.filter(Boolean).length).toBe(MAX_LABELS)
  })
})
