import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBuildings } from '../buildings/buildings'
import type { Cycle } from '../flows/cycles'
import { createFading } from '../render/dimming'
import { islandShapes } from '../terrain/island-shape'
import type { CityLayout, FileMetrics } from '../world/layout'
import { CityGuide, cityGuideView } from './city-guide'
import { cityTargets } from './targets'

const file = (path: string): FileMetrics => ({
  path,
  language: 'typescript',
  lines: 200,
  complexity: 10,
  test: false,
})

// Two islands; the first has a folder, `a/ui`, in its north half, with one of its two files.
const LAYOUT: CityLayout = {
  islands: [
    {
      path: 'a',
      layer: 1,
      plateau: { x: 0, y: 0, width: 10, height: 10 },
      parcels: [
        { rect: { x: 0, y: 5, width: 10, height: 5 }, path: 'a/ui', level: 1, nature: 'normal' },
      ],
      lots: [
        { x: 3, y: 3, file: file('a/main.ts') },
        { x: 3, y: 7, file: file('a/ui/view.ts') },
      ],
    },
    {
      path: 'b',
      layer: 1,
      plateau: { x: 40, y: 0, width: 10, height: 10 },
      parcels: [],
      lots: [{ x: 43, y: 3, file: file('b/util.ts') }],
    },
  ],
  bounds: { x: 0, y: 0, width: 50, height: 10 },
}

const CYCLE: Cycle = { members: [0, 1], loop: [0, 1], next: new Map([[0, [1]]]) }

function setup() {
  const buildings = createBuildings(LAYOUT, 1, createFading())
  const guide = new CityGuide(LAYOUT, islandShapes(LAYOUT), buildings, 1)
  // The cycle's rings and its arcs are always there; marks come and go.
  const marks = () => guide.group.children.length - 2
  return { guide, marks }
}

describe('cityGuideView', () => {
  it('finds buildings, folders and a cycle by path, and leaves out what the city lacks', () => {
    const view = cityGuideView(
      {
        files: ['a/main.ts', 'b/util.ts', 'gone.ts'],
        labelled: ['a/main.ts'],
        folders: ['a/ui', 'b', 'gone'],
        fade: 'others',
        cycle: 'a/ui/view.ts',
      },
      LAYOUT,
      cityTargets(LAYOUT),
      (building) => (building === 1 ? CYCLE : undefined),
    )
    expect(view).toEqual({
      buildings: [0, 2],
      labelled: [0],
      areas: [{ island: 0, rect: { x: 0, y: 5, width: 10, height: 5 }, level: 1 }, { island: 1 }],
      fade: 'others',
      cycle: CYCLE,
    })
  })
})

describe('CityGuide', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('marks each building but the selected one, and rings each folder', () => {
    const { guide, marks } = setup()
    guide.show({
      buildings: [0, 2],
      labelled: [0],
      areas: [{ island: 1 }],
      fade: 'all',
      cycle: null,
    })
    expect(marks()).toBe(3)
    expect(guide.has(2)).toBe(true)
    guide.setSelected(0)
    expect(marks()).toBe(2)
    // Still put forward: the hover leaves it alone.
    expect(guide.has(0)).toBe(true)
    guide.setSelected(null)
    expect(marks()).toBe(3)
    guide.show(null)
    expect(marks()).toBe(0)
    expect(guide.labels()).toEqual([])
  })

  it('keeps what it puts forward and a cycle, or what stands in its folders', () => {
    // The cycle's badge is drawn on a canvas, which the tests have none of.
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) })
    const { guide } = setup()
    expect(guide.kept()).toBeNull()
    guide.show({ buildings: [2], labelled: [], areas: [], fade: 'all', cycle: CYCLE })
    const all = guide.kept()
    expect([0, 1, 2].map((index) => all?.kept(index))).toEqual([true, true, true])
    guide.show({ buildings: [], labelled: [], areas: [], fade: 'all', cycle: null })
    expect([0, 1, 2].map((index) => guide.kept()?.kept(index))).toEqual([false, false, false])
    guide.show({
      buildings: [],
      labelled: [],
      areas: [{ island: 0, rect: { x: 0, y: 5, width: 10, height: 5 }, level: 1 }],
      fade: 'others',
      cycle: null,
    })
    const others = guide.kept()
    expect([0, 1, 2].map((index) => others?.kept(index))).toEqual([false, true, false])
    // The trees of the parcel, board y along three.js −z.
    expect(others?.trees).toEqual([0, -10, 10, -5])
    guide.show({ buildings: [2], labelled: [], areas: [], fade: 'none', cycle: null })
    expect(guide.kept()).toBeNull()
    guide.dispose()
  })
})
