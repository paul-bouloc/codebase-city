import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type CityBuildings, createBuildings, Highlight } from '../buildings/buildings'
import { indexCycles } from '../flows/cycles'
import { indexImports } from '../flows/selection-links'
import { createFading } from '../render/dimming'
import { islandShapes } from '../terrain/island-shape'
import type { Ferry } from '../waterways/links'
import type { CityLayout, FileMetrics } from '../world/layout'
import { CityInteraction } from './city-interaction'
import { type CityItem, isClick } from './city-items'

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

/** The buildings, with what each one's highlight and kept flag are now. */
function setup(layout = LAYOUT, ferries: Ferry[] = []) {
  const fading = createFading()
  const real = createBuildings(layout, 1, fading)
  const highlights = real.placed.map(() => Highlight.none as Highlight)
  let kept: ((index: number) => boolean) | null = null
  const buildings: CityBuildings = {
    ...real,
    setHighlight(index, highlight) {
      highlights[index] = highlight
      real.setHighlight(index, highlight)
    },
    setKept(keep) {
      kept = keep
      real.setKept(keep)
    },
  }
  const selections: (CityItem | null)[] = []
  const interaction = new CityInteraction(
    layout,
    islandShapes(layout),
    buildings,
    { imports: indexImports(layout), cycles: indexCycles(layout), bridges: [], ferries },
    fading,
    1,
    () => ({ select: (item) => selections.push(item) }),
    () => {},
  )
  const keptNow = () => real.placed.map((_, index) => (kept ? kept(index) : true))
  return { interaction, highlights, keptNow, selections, fading }
}

const POINTER = { x: 10, y: 10 }

describe('CityInteraction', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('lights up a hovered building, then marks it selected and fades the rest', () => {
    const { interaction, highlights, keptNow, selections, fading } = setup()
    interaction.point({ kind: 'building', index: 0 }, POINTER)
    expect(highlights).toEqual([Highlight.hovered, Highlight.none, Highlight.none])

    interaction.select({ kind: 'building', index: 0 })
    expect(highlights).toEqual([Highlight.selected, Highlight.none, Highlight.none])
    expect(keptNow()).toEqual([true, false, false])
    expect(selections).toEqual([{ target: { kind: 'building', index: 0 }, path: 'a/main.ts' }])

    // The fading runs over 280 ms from the first frame after the click.
    interaction.update(1000)
    interaction.update(1140)
    expect(fading.dim.value).toBeGreaterThan(0.5)
    expect(fading.dim.value).toBeLessThan(1)
    interaction.update(1280)
    expect(fading.dim.value).toBe(1)
    expect(interaction.update(1300)).toBe(false)
  })

  it('keeps the selected mark while another building is hovered and left', () => {
    const { interaction, highlights } = setup()
    interaction.select({ kind: 'building', index: 0 })
    interaction.point({ kind: 'building', index: 2 }, POINTER)
    expect(highlights).toEqual([Highlight.selected, Highlight.none, Highlight.hovered])
    interaction.point({ kind: 'building', index: 0 }, POINTER)
    // Hovering the selected building leaves it selected.
    expect(highlights).toEqual([Highlight.selected, Highlight.none, Highlight.none])
    interaction.point(null, POINTER)
    expect(highlights).toEqual([Highlight.selected, Highlight.none, Highlight.none])
  })

  it('keeps the buildings of a selected folder, and of a selected island', () => {
    const { interaction, keptNow, selections } = setup()
    interaction.select({ kind: 'parcel', island: 0, parcel: 0 })
    expect(keptNow()).toEqual([false, true, false])
    interaction.select({ kind: 'island', island: 0 })
    expect(keptNow()).toEqual([true, true, false])
    expect(selections.map((item) => item?.path)).toEqual(['a/ui', 'a'])
  })

  it('tells of a click on what is already selected, without changing anything', () => {
    const { interaction, highlights, selections } = setup()
    interaction.select({ kind: 'building', index: 0 })
    interaction.select({ kind: 'building', index: 0 })
    expect(selections.map((item) => item?.path)).toEqual(['a/main.ts', 'a/main.ts'])
    expect(highlights).toEqual([Highlight.selected, Highlight.none, Highlight.none])
    interaction.select(null)
    interaction.select(null)
    expect(selections.at(-1)).toBeNull()
    expect(selections).toHaveLength(3)
  })

  it('lets the selection go: back to normal colours, and nothing selected', () => {
    const { interaction, highlights, selections, fading } = setup()
    interaction.select({ kind: 'building', index: 1 })
    interaction.update(0)
    interaction.update(300)
    interaction.select(null)
    expect(highlights).toEqual([Highlight.none, Highlight.none, Highlight.none])
    expect(selections.at(-1)).toBeNull()
    expect(interaction.getSelection()).toBeNull()
    interaction.update(400)
    interaction.update(700)
    expect(fading.dim.value).toBe(0)
  })

  it('keeps the files linked to a selected one, and draws its arcs while it lasts', () => {
    // `a/main.ts` imports `b/util.ts`
    const { interaction, keptNow, highlights } = setup({
      ...LAYOUT,
      imports: [{ from: { island: 0, lot: 0 }, to: { island: 1, lot: 0 }, upward: false }],
    })
    interaction.select({ kind: 'building', index: 0 })
    expect(keptNow()).toEqual([true, false, true])
    expect(interaction.arcs.group.visible).toBe(true)
    expect(interaction.getHubs()).toEqual([])
    // A linked building still lights up under the pointer
    interaction.point({ kind: 'building', index: 2 }, POINTER)
    expect(highlights[2]).toBe(Highlight.hovered)
    interaction.select({ kind: 'building', index: 1 })
    expect(interaction.arcs.group.visible).toBe(false)
    interaction.select(null)
    expect(interaction.arcs.group.visible).toBe(false)
  })

  it('rings the files of the cycle of a selected one, and keeps them', () => {
    // The cycle's badge is drawn on a canvas, which the tests have none of.
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) })
    // `a/main.ts` and `a/ui/view.ts` import each other
    const { interaction, keptNow } = setup({
      ...LAYOUT,
      cycles: [
        {
          members: [
            { island: 0, lot: 0 },
            { island: 0, lot: 1 },
          ],
          loop: [0, 1],
          imports: [
            [0, 1],
            [1, 0],
          ],
        },
      ],
    })
    interaction.select({ kind: 'building', index: 1 })
    expect(keptNow()).toEqual([true, true, false])
    expect(interaction.cycleRings.group.visible).toBe(true)
    expect(interaction.arcs.group.visible).toBe(true)
    interaction.select({ kind: 'building', index: 2 })
    expect(interaction.cycleRings.group.visible).toBe(false)
    expect(interaction.arcs.group.visible).toBe(false)
    vi.unstubAllGlobals()
  })

  it('lines the ferries of a selected folder, and lets them go with it', () => {
    // `a/ui/view.ts` imports `b/util.ts`, by ferry
    const { interaction } = setup(
      {
        ...LAYOUT,
        links: [{ from: 0, to: 1, imports: 1, upward: 0 }],
        imports: [{ from: { island: 0, lot: 1 }, to: { island: 1, lot: 0 }, upward: false }],
      },
      [
        {
          a: 0,
          b: 1,
          imports: 1,
          upward: false,
          path: [
            { x: 10, y: 5 },
            { x: 40, y: 5 },
          ],
        },
      ],
    )
    interaction.select({ kind: 'island', island: 1 })
    expect(interaction.folderLinks.group.visible).toBe(true)
    // `a/ui` imports from `b`
    interaction.select({ kind: 'parcel', island: 0, parcel: 0 })
    expect(interaction.folderLinks.group.visible).toBe(true)
    interaction.select({ kind: 'building', index: 1 })
    expect(interaction.folderLinks.group.visible).toBe(false)
  })
})

describe('isClick', () => {
  it('takes a press that barely moves for a click, and a longer one for a drag', () => {
    expect(isClick({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(true)
    expect(isClick({ x: 100, y: 100 }, { x: 103, y: 102 })).toBe(true)
    expect(isClick({ x: 100, y: 100 }, { x: 105, y: 100 })).toBe(false)
  })
})
