import { describe, expect, it } from 'vitest'
import { FAR_TILT, maxTilt, NEAR_TILT } from './tilt'

describe('maxTilt', () => {
  it('holds the near tilt close up', () => {
    expect(maxTilt(6, 400)).toBe(NEAR_TILT)
    expect(maxTilt(100, 400)).toBe(NEAR_TILT)
  })

  it('reaches the far tilt once the whole city is in view, and keeps it beyond', () => {
    expect(maxTilt(400, 400)).toBe(FAR_TILT)
    expect(maxTilt(800, 400)).toBe(FAR_TILT)
  })

  it('goes down steadily in between, halfway at the middle of the zoom', () => {
    const steps = [120, 150, 200, 260, 330].map((d) => maxTilt(d, 400))
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeGreaterThan(steps[i - 1] ?? 0)
    }
    expect(maxTilt(200, 400)).toBeCloseTo((NEAR_TILT + FAR_TILT) / 2)
  })

  it('keeps the near tilt with no city framed', () => {
    expect(maxTilt(50, 0)).toBe(NEAR_TILT)
  })
})
