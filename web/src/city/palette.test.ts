import { describe, expect, it } from 'vitest'
import { mixHex } from './palette'

describe('mixHex', () => {
  it('keeps either end and mixes each channel in between', () => {
    expect(mixHex('#E9DDC7', '#000000', 0)).toBe('#E9DDC7')
    expect(mixHex('#E9DDC7', '#000000', 1)).toBe('#000000')
    expect(mixHex('#FF0080', '#000000', 0.5)).toBe('#800040')
  })
})
