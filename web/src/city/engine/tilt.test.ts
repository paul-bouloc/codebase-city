import { describe, expect, it } from 'vitest'
import { FAR_TILT, maxTilt, NEAR_TILT } from './tilt'

describe('maxTilt', () => {
  it('holds the near tilt as close as the camera gets', () => {
    expect(maxTilt(6, 6, 400)).toBe(NEAR_TILT)
    expect(maxTilt(3, 6, 400)).toBe(NEAR_TILT)
  })

  it('reaches the far tilt once the whole city is in view, and keeps it beyond', () => {
    expect(maxTilt(400, 6, 400)).toBe(FAR_TILT)
    expect(maxTilt(800, 6, 400)).toBe(FAR_TILT)
  })

  it('comes down by the same step for each doubling of the distance', () => {
    const steps = [6, 12, 24, 48, 96, 192].map((d) => maxTilt(d, 6, 384))
    for (let i = 1; i < steps.length; i++) {
      expect((steps[i] ?? 0) - (steps[i - 1] ?? 0)).toBeCloseTo((FAR_TILT - NEAR_TILT) / 6)
    }
  })

  it('keeps the near tilt when the city fits as close as the camera gets', () => {
    expect(maxTilt(50, 6, 6)).toBe(NEAR_TILT)
  })
})
