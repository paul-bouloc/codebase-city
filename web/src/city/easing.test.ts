import { describe, expect, it } from 'vitest'
import { cubicBezier, easeStandard } from './easing'

describe('cubicBezier', () => {
  it('runs from 0 to 1, and is the identity for a straight curve', () => {
    const linear = cubicBezier(1 / 3, 1 / 3, 2 / 3, 2 / 3)
    for (const t of [0, 0.1, 0.25, 0.5, 0.9, 1]) {
      expect(linear(t)).toBeCloseTo(t, 6)
    }
  })

  it('matches the CSS ease curve', () => {
    // Values of `ease` (0.25, 0.1, 0.25, 1) as browsers compute them.
    const ease = cubicBezier(0.25, 0.1, 0.25, 1)
    expect(ease(0.25)).toBeCloseTo(0.409, 2)
    expect(ease(0.5)).toBeCloseTo(0.802, 2)
  })

  it('makes the standard easing start fast and settle slowly', () => {
    expect(easeStandard(0)).toBe(0)
    expect(easeStandard(1)).toBe(1)
    expect(easeStandard(0.3)).toBeGreaterThan(0.6)
    let previous = 0
    for (let t = 0.05; t <= 1; t += 0.05) {
      expect(easeStandard(t)).toBeGreaterThanOrEqual(previous)
      previous = easeStandard(t)
    }
  })
})
