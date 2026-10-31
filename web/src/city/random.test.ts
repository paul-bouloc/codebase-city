import { describe, expect, it } from 'vitest'
import { hashString, seededRandom } from './random'

describe('hashString', () => {
  it('matches the FNV-1a reference values', () => {
    expect(hashString('')).toBe(0x811c9dc5)
    expect(hashString('a')).toBe(0xe40c292c)
    expect(hashString('foobar')).toBe(0xbf9cf968)
  })
})

describe('seededRandom', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = seededRandom('src/app')
    const b = seededRandom('src/app')
    expect(Array.from({ length: 5 }, a)).toEqual(Array.from({ length: 5 }, b))
  })

  it('differs between seeds', () => {
    expect(seededRandom('src/app')()).not.toBe(seededRandom('src/lib')())
  })

  it('stays in [0, 1)', () => {
    const next = seededRandom('range')
    for (let i = 0; i < 10_000; i++) {
      const value = next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})
