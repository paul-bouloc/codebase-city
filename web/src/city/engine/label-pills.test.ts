import { describe, expect, it } from 'vitest'
import { fadeToward } from './label-pills'

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
