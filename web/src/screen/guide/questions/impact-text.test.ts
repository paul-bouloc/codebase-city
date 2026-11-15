import { describe, expect, it } from 'vitest'
import type { Impact } from './impact'
import { impactText, otherIslandsText } from './impact-text'

const impact = (dependents: number, direct: number, tests = 0, files = 1000): Impact => ({
  file: 0,
  dependents: Array.from({ length: dependents }, (_, at) => at + 1),
  direct,
  tests,
  files,
  islands: [],
  otherIslands: null,
})

describe('impactText', () => {
  it('says how many, their share, direct and through other files', () => {
    expect(impactText(impact(410, 120), 'nls.ts')).toEqual({
      lead: '410 files depend on',
      none: null,
      detail: '41% of the repository · 120 directly, 290 through other files.',
      dependents: 410,
    })
  })

  it('counts the tests among them, and keeps one file in the singular', () => {
    const text = impactText(impact(1, 1, 1), 'a.ts')
    expect(text.lead).toBe('1 file depends on')
    expect(text.detail).toBe('<1% of the repository · 1 directly, 0 through other files · 1 test.')
  })

  it('says so plainly when nothing depends on it', () => {
    expect(impactText(impact(0, 0), 'main.ts')).toEqual({
      lead: null,
      none: 'No file depends on main.ts.',
      detail: null,
      dependents: 0,
    })
  })
})

describe('otherIslandsText', () => {
  it('names the islands past the rows', () => {
    expect(otherIslandsText(1)).toBe('1 other island')
    expect(otherIslandsText(58)).toBe('58 other islands')
  })
})
