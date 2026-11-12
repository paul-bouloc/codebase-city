import { describe, expect, it } from 'vitest'
import { LABEL_LIFT, placeUnitLabels, type UnitLabelCandidate } from './unit-label-placement'

const CANVAS = { width: 1000, height: 800 }

function label(change: Partial<UnitLabelCandidate> = {}): UnitLabelCandidate {
  return { x: 500, y: 400, width: 100, height: 40, ...change }
}

describe('placeUnitLabels', () => {
  it('stands a label straight over its anchor', () => {
    expect(placeUnitLabels([label()], CANVAS)).toEqual([{ x: 450, y: 400 - LABEL_LIFT - 40 }])
  })

  it('raises a later label over an earlier one, never aside', () => {
    const [first, second] = placeUnitLabels([label(), label({ x: 520, y: 410 })], CANVAS)
    expect(first).toEqual({ x: 450, y: 336 })
    // Its own place is covered: it stands over the first, the gap between
    expect(second).toEqual({ x: 470, y: 336 - 6 - 40 })
  })

  it('leaves a label that covers none where it stands', () => {
    const placed = placeUnitLabels([label(), label({ x: 800 })], CANVAS)
    expect(placed[1]).toEqual({ x: 750, y: 336 })
  })

  it('rises a bounded number of times', () => {
    const placed = placeUnitLabels(
      Array.from({ length: 12 }, () => label()),
      CANVAS,
    )
    expect(placed.at(-1)?.y).toBe(336 - 8 * 46)
  })

  it('keeps a label inside the canvas across', () => {
    expect(placeUnitLabels([label({ x: 10 })], CANVAS)[0]?.x).toBe(0)
  })
})
