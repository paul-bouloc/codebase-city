import { describe, expect, it } from 'vitest'
import { FOLDED, type GuideState, nextGuide, tourLength } from './guide-state'

const at = (step: number): GuideState => ({ mode: 'touring', step })

describe('nextGuide', () => {
  it('opens, starts the tour from its first step, and folds', () => {
    expect(nextGuide(FOLDED, { kind: 'open' }, 9)).toEqual({ mode: 'open', step: 0 })
    expect(nextGuide({ mode: 'open', step: 0 }, { kind: 'start' }, 9)).toEqual(at(0))
    expect(nextGuide(at(4), { kind: 'fold' }, 9)).toEqual(FOLDED)
  })

  it('goes forward and back within the tour', () => {
    expect(nextGuide(at(0), { kind: 'next' }, 9)).toEqual(at(1))
    expect(nextGuide(at(1), { kind: 'back' }, 9)).toEqual(at(0))
    expect(nextGuide(at(0), { kind: 'back' }, 9)).toEqual(at(0))
  })

  it('folds after the last step: Done', () => {
    expect(nextGuide(at(8), { kind: 'next' }, 9)).toEqual(FOLDED)
  })

  it('moves nothing when no tour plays', () => {
    expect(nextGuide(FOLDED, { kind: 'next' }, 9)).toEqual(FOLDED)
    expect(nextGuide(FOLDED, { kind: 'start' }, 0)).toEqual(FOLDED)
  })
})

describe('tourLength', () => {
  it('counts the steps and their time, to the minute', () => {
    expect(tourLength(9)).toBe('9 steps · about 2 min')
    expect(tourLength(1)).toBe('1 step · about 1 min')
    expect(tourLength(15)).toBe('15 steps · about 3 min')
  })
})
