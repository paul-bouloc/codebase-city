import { describe, expect, it } from 'vitest'
import { lightFactor, SUN_DIRECTION } from './light'

describe('SUN_DIRECTION', () => {
  it('is a unit vector above the horizon, in the north-west', () => {
    const [x, y, z] = SUN_DIRECTION
    expect(Math.hypot(x, y, z)).toBeCloseTo(1)
    expect(y).toBeGreaterThan(0)
    expect(x).toBeLessThan(0)
    // Board +y (north) is three.js -z.
    expect(z).toBeLessThan(0)
  })
})

describe('lightFactor', () => {
  it('leaves a flat roof at its exact colour', () => {
    const up = SUN_DIRECTION[1]
    expect(lightFactor(up)).toBeCloseTo(1, 2)
  })

  it('never goes below the ambient share, even facing away from the sun', () => {
    expect(lightFactor(-1)).toBeCloseTo(0.7 / 0.93)
    expect(lightFactor(0)).toBe(lightFactor(-0.5))
  })
})
