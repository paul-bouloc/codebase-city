import { describe, expect, it } from 'vitest'
import { MIN_THUMB, scrollForThumbDelta, thumbGeometry } from './scroll-thumb'

describe('thumbGeometry', () => {
  it('has no thumb when the content fits', () => {
    expect(thumbGeometry(500, 500, 0, 500)).toBeNull()
    expect(thumbGeometry(500, 300, 0, 500)).toBeNull()
  })

  it('sizes the thumb by the visible share and moves it with the scroll', () => {
    expect(thumbGeometry(500, 1000, 0, 500)).toEqual({ size: 250, offset: 0 })
    expect(thumbGeometry(500, 1000, 250, 500)).toEqual({ size: 250, offset: 125 })
    expect(thumbGeometry(500, 1000, 500, 500)).toEqual({ size: 250, offset: 250 })
  })

  it('keeps a thumb large enough to catch', () => {
    expect(thumbGeometry(100, 100_000, 0, 100)?.size).toBe(MIN_THUMB)
  })

  it('clamps an overscrolled position', () => {
    expect(thumbGeometry(500, 1000, 900, 500)?.offset).toBe(250)
  })
})

describe('scrollForThumbDelta', () => {
  it('maps the thumb travel onto the scroll range', () => {
    // A 250 px thumb on a 500 px track has 250 px of travel for 500 px of scroll.
    expect(scrollForThumbDelta(125, 500, 1000, 500, 250)).toBe(250)
    expect(scrollForThumbDelta(10, 500, 500, 500, 500)).toBe(0)
  })
})
