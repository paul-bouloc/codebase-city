import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type CityBuildings, createBuildings, Highlight } from './buildings'
import { CityInteraction, type CityItem, isClick } from './city-interaction'
import { createFading } from './dimming'
import { HOVER_DELAYS } from './hover-timing'
import { islandShapes } from './island-shape'
import type { CityLayout, FileMetrics } from './layout'

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
function setup() {
  const fading = createFading()
  const real = createBuildings(LAYOUT, 1, fading)
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
    LAYOUT,
    islandShapes(LAYOUT),
    buildings,
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
    vi.advanceTimersByTime(HOVER_DELAYS.highlight)
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
    vi.advanceTimersByTime(HOVER_DELAYS.highlight)
    expect(highlights).toEqual([Highlight.selected, Highlight.none, Highlight.hovered])
    interaction.point({ kind: 'building', index: 0 }, POINTER)
    vi.advanceTimersByTime(HOVER_DELAYS.highlight)
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

  it('does not tell twice of the same selection', () => {
    const { interaction, selections } = setup()
    interaction.select({ kind: 'island', island: 1 })
    interaction.select({ kind: 'island', island: 1 })
    expect(selections).toHaveLength(1)
  })
})

describe('isClick', () => {
  it('takes a press that barely moves for a click, and a longer one for a drag', () => {
    expect(isClick({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(true)
    expect(isClick({ x: 100, y: 100 }, { x: 103, y: 102 })).toBe(true)
    expect(isClick({ x: 100, y: 100 }, { x: 105, y: 100 })).toBe(false)
  })
})
