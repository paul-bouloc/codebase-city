import { describe, expect, it } from 'vitest'
import { confirmationMatches } from './confirmation'

describe('confirmationMatches', () => {
  it('is case-sensitive and forgives surrounding spaces', () => {
    expect(confirmationMatches('lena-okafor', 'lena-okafor')).toBe(true)
    expect(confirmationMatches('  lena-okafor ', 'lena-okafor')).toBe(true)
    expect(confirmationMatches('Lena-Okafor', 'lena-okafor')).toBe(false)
    expect(confirmationMatches('lena-okafo', 'lena-okafor')).toBe(false)
  })
})
