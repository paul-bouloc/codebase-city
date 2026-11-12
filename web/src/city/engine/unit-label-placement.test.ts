import { describe, expect, it } from 'vitest'
import { LABEL_LIFT, placeUnitLabels, type UnitLabelCandidate } from './unit-label-placement'

const CANVAS = { width: 1000, height: 800 }

function label(change: Partial<UnitLabelCandidate> = {}): UnitLabelCandidate {
  return { x: 500, y: 400, width: 100, height: 40, previous: null, ...change }
}

const overlapping = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) < 100 && Math.abs(a.y - b.y) < 40

describe('placeUnitLabels', () => {
  it('stands a label over its anchor, centred', () => {
    expect(placeUnitLabels([label()], [], CANVAS)).toEqual([{ x: 450, y: 400 - LABEL_LIFT - 40 }])
  })

  it('slides a later label off an earlier one', () => {
    const [first, second] = placeUnitLabels([label(), label({ x: 510 })], [], CANVAS)
    expect(first).toEqual({ x: 450, y: 337 })
    expect(first && second && overlapping(first, second)).toBe(false)
  })

  it('slides a label off the islands the step shows', () => {
    const island = { x: 380, y: 300, width: 240, height: 100 }
    const [placed] = placeUnitLabels([label()], [island], CANVAS)
    const clear =
      placed &&
      (placed.x + 100 <= island.x ||
        placed.x >= island.x + island.width ||
        placed.y + 40 <= island.y ||
        placed.y >= island.y + island.height)
    expect(clear).toBe(true)
  })

  it('keeps a label inside the canvas', () => {
    const [placed] = placeUnitLabels([label({ x: 10, y: 20 })], [], CANVAS)
    expect(placed).toEqual({ x: 4, y: 4 })
  })

  it('keeps a label on show where it stood while that is nearly as good', () => {
    const previous = { x: -50, y: -LABEL_LIFT - 40 - 24 }
    expect(placeUnitLabels([label({ previous })], [], CANVAS)).toEqual([{ x: 450, y: 313 }])
    // Far from its home, it comes back
    const far = { x: 300, y: -LABEL_LIFT - 40 }
    expect(placeUnitLabels([label({ previous: far })], [], CANVAS)).toEqual([{ x: 450, y: 337 }])
  })
})
