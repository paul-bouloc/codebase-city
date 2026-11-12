import type { Mesh, ShaderMaterial } from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fadeToward, LabelPills, type PlacedLabel } from './label-pills'

describe('fadeToward', () => {
  it('stays at its target', () => {
    expect(fadeToward(1, 1, 0.1)).toBe(1)
    expect(fadeToward(0, 0, 0.1)).toBe(0)
  })

  it('comes a step closer, and no further', () => {
    expect(fadeToward(0, 1, 0.25)).toBe(0.25)
    expect(fadeToward(0.9, 1, 0.25)).toBe(1)
    expect(fadeToward(1, 0, 0.25)).toBe(0.75)
    expect(fadeToward(0.1, 0, 0.25)).toBe(0)
  })
})

function label(overrides: Partial<PlacedLabel> = {}): PlacedLabel {
  return {
    path: 'core',
    island: true,
    name: 'core',
    caption: null,
    selected: false,
    lean: 'end',
    anchor: [0, 0, 0],
    x: 100,
    y: 50,
    box: { x: 60, y: 40, width: 40, height: 20 },
    ...overrides,
  }
}

const opacityOf = (pills: LabelPills) =>
  ((pills.group.children[0] as Mesh | undefined)?.material as ShaderMaterial | undefined)?.uniforms
    .opacity?.value

const SHOW = { snap: false, instant: false }

/** Shows `labels` frame after frame from `now`, until no pill fades any more. */
function settle(pills: LabelPills, labels: readonly PlacedLabel[], now: number) {
  let time = now
  for (let frame = 0; frame < 100 && pills.show(labels, time, SHOW); frame += 1) {
    time += 16
  }
}

describe('LabelPills', () => {
  // No page in the tests: pills draw on canvases that draw nothing.
  beforeEach(() => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fades a label in over frames, even the first frame after the city stood still', () => {
    const pills = new LabelPills(() => 1)
    pills.show([], 0, SHOW)
    // Seconds without a frame: the label still fades in rather than shows at once.
    expect(pills.show([label()], 5000, SHOW)).toBe(true)
    expect(opacityOf(pills)).toBeGreaterThan(0)
    expect(opacityOf(pills)).toBeLessThan(1)
    settle(pills, [label()], 5016)
    expect(opacityOf(pills)).toBe(1)
  })

  it('keeps its opacity when a label is drawn again, and drops it once faded out', () => {
    const pills = new LabelPills(() => 1)
    pills.show([label()], 0, { snap: false, instant: true })
    pills.show([label({ caption: '12 files' })], 16, SHOW)
    expect(pills.group.children).toHaveLength(1)
    expect(opacityOf(pills)).toBe(1)
    settle(pills, [], 32)
    expect(pills.group.children).toHaveLength(0)
  })

  it('takes every pill away at once on clear', () => {
    const pills = new LabelPills(() => 1)
    pills.show([label(), label({ path: 'web', name: 'web' })], 0, SHOW)
    expect(pills.group.children).toHaveLength(2)
    pills.clear()
    expect(pills.group.children).toHaveLength(0)
  })
  it('draws a label of the guide with its leaders, ends them under it, and fades them with it', () => {
    const pills = new LabelPills(() => 2)
    const guide = label({
      guide: 'full',
      caption: 'app · 12 files',
      leads: [
        [0, 0, 0],
        [5, 0, 5],
      ],
    })
    pills.show([guide], 0, { snap: false, instant: true })
    expect(pills.group.children).toHaveLength(3)
    const lead = pills.group.children[1] as Mesh
    const { uniforms } = lead.material as ShaderMaterial
    // The middle of the box's bottom, (80, 60), from the anchor (100, 50), in device pixels
    expect(uniforms.offset?.value.toArray()).toEqual([-40, 20])
    expect(uniforms.opacity?.value).toBe(1)
    settle(pills, [], 16)
    expect(pills.group.children).toHaveLength(0)
  })
})
