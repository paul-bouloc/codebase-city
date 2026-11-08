import { describe, expect, it } from 'vitest'
import { editDistance, fuzzyMatch } from './search-match'

const match = (query: string, text: string) =>
  fuzzyMatch(query, query.toLowerCase(), text, text.toLowerCase())

const highlighted = (query: string, text: string) =>
  (match(query, text)?.positions ?? []).map((position) => text[position]).join('')

describe('fuzzyMatch', () => {
  it('finds the letters in order, whatever the case', () => {
    expect(match('txtmdl', 'textModel.ts')).not.toBeNull()
    expect(match('TEXTMODEL', 'textModel.ts')).not.toBeNull()
  })

  it('finds nothing when a letter is missing or out of order', () => {
    expect(match('txtmdlz', 'textModel.ts')).toBeNull()
    expect(match('ledom', 'textModel.ts')).toBeNull()
    expect(match('', 'textModel.ts')).toBeNull()
    expect(match('textModel.tsx', 'textModel.ts')).toBeNull()
  })

  it('matches word starts and camel humps rather than the first letters that fit', () => {
    // m of Model, not of nothing earlier; s of Search, not the s of textModel… there is none.
    expect(match('tms', 'textModelSearch.ts')?.positions).toEqual([0, 4, 9])
  })

  it('prefers the query as one run', () => {
    expect(highlighted('model', 'textModel.ts')).toBe('Model')
    expect(match('model', 'textModel.ts')?.positions).toEqual([4, 5, 6, 7, 8])
  })

  it('ranks a whole word, then a word start, then scattered letters', () => {
    const score = (text: string) => match('model', text)?.score ?? Number.NEGATIVE_INFINITY
    expect(score('model')).toBeGreaterThan(score('model.ts'))
    expect(score('model.ts')).toBeGreaterThan(score('textModel.ts'))
    expect(score('textModel.ts')).toBeGreaterThan(score('remodel.ts'))
    expect(score('remodel.ts')).toBeGreaterThan(score('maxoxdexl.ts'))
  })

  it('scores the textModel family above a scattered match', () => {
    const score = (text: string) => match('textmod', text)?.score ?? Number.NEGATIVE_INFINITY
    expect(score('textModel.ts')).toBeGreaterThan(score('textDiffModel.ts'))
    expect(score('textModelSearch.ts')).toBeGreaterThan(score('textDiffModel.ts'))
  })
})

describe('editDistance', () => {
  it('counts insertions, deletions, substitutions and swaps', () => {
    expect(editDistance('teminal', 'terminal', 2)).toBe(1)
    expect(editDistance('terminal', 'terminal', 2)).toBe(0)
    expect(editDistance('termnial', 'terminal', 2)).toBe(1)
    expect(editDistance('tarminel', 'terminal', 2)).toBe(2)
  })

  it('stops at the bound', () => {
    expect(editDistance('abc', 'xyz', 1)).toBe(2)
    expect(editDistance('a', 'abcdef', 2)).toBe(3)
  })
})
