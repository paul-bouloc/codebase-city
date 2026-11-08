import { describe, expect, it } from 'vitest'
import { placeTooltip } from './tooltip-placement'

const SIZE = { width: 380, height: 120 }
const SCREEN = { width: 1440, height: 900 }

describe('placeTooltip', () => {
  it('sits 24 px right of the pointer, below it', () => {
    expect(placeTooltip({ x: 500, y: 400 }, SIZE, SCREEN)).toEqual({ x: 524, y: 400 })
  })

  it('flips left near the right edge', () => {
    // 1100 + 24 + 380 = 1504 > 1440 − 16.
    expect(placeTooltip({ x: 1100, y: 400 }, SIZE, SCREEN)).toEqual({ x: 696, y: 400 })
  })

  it('stays on the right while it fits exactly', () => {
    // 1020 + 24 + 380 = 1424 = 1440 − 16.
    expect(placeTooltip({ x: 1020, y: 400 }, SIZE, SCREEN).x).toBe(1044)
  })

  it('flips above near the bottom edge', () => {
    expect(placeTooltip({ x: 500, y: 800 }, SIZE, SCREEN)).toEqual({ x: 524, y: 680 })
  })

  it('flips both ways in the bottom right corner', () => {
    expect(placeTooltip({ x: 1300, y: 850 }, SIZE, SCREEN)).toEqual({ x: 896, y: 730 })
  })

  it('keeps off an open panel', () => {
    // The file sheet: 400 px on the right, under the top bar.
    const sheet = { x: 1028, y: 84, width: 400, height: 804 }
    expect(placeTooltip({ x: 700, y: 400 }, SIZE, SCREEN, [sheet])).toEqual({ x: 296, y: 400 })
  })

  it('pushes the default side back inside when nothing fits', () => {
    const small = { width: 300, height: 100 }
    expect(placeTooltip({ x: 150, y: 50 }, SIZE, small)).toEqual({ x: 16, y: 16 })
  })
})
