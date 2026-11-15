import { describe, expect, it } from 'vitest'
import { FOLDED, type GuideState, nextGuide, tourLength } from './guide-state'

const at = (step: number, playing = true): GuideState => ({ mode: 'touring', step, playing })
const OPEN: GuideState = { mode: 'open', step: 0, playing: false }

describe('nextGuide', () => {
  it('opens, starts the tour playing from its first step, and folds', () => {
    expect(nextGuide(FOLDED, { kind: 'open' }, 9)).toEqual(OPEN)
    expect(nextGuide(OPEN, { kind: 'start' }, 9)).toEqual(at(0))
    expect(nextGuide(at(4), { kind: 'fold' }, 9)).toEqual(FOLDED)
  })

  it('goes forward and back within the tour, playing or paused as it was', () => {
    expect(nextGuide(at(0), { kind: 'next' }, 9)).toEqual(at(1))
    expect(nextGuide(at(1), { kind: 'back' }, 9)).toEqual(at(0))
    expect(nextGuide(at(0), { kind: 'back' }, 9)).toEqual(at(0))
    expect(nextGuide(at(3, false), { kind: 'next' }, 9)).toEqual(at(4, false))
    expect(nextGuide(at(3, false), { kind: 'back' }, 9)).toEqual(at(2, false))
  })

  it('folds after the last step: Done', () => {
    expect(nextGuide(at(8), { kind: 'next' }, 9)).toEqual(FOLDED)
  })

  it('moves nothing when no tour plays', () => {
    expect(nextGuide(FOLDED, { kind: 'next' }, 9)).toEqual(FOLDED)
    expect(nextGuide(FOLDED, { kind: 'start' }, 0)).toEqual(FOLDED)
    expect(nextGuide(OPEN, { kind: 'pause' }, 9)).toEqual(OPEN)
    expect(nextGuide(FOLDED, { kind: 'advance' }, 9)).toEqual(FOLDED)
  })

  it('pauses on the same step', () => {
    expect(nextGuide(at(2), { kind: 'pause' }, 9)).toEqual(at(2, false))
    const paused = at(2, false)
    expect(nextGuide(paused, { kind: 'pause' }, 9)).toBe(paused)
  })

  it('toggles with Space, and starts the tour when none is on', () => {
    expect(nextGuide(at(2), { kind: 'toggle' }, 9)).toEqual(at(2, false))
    expect(nextGuide(at(2, false), { kind: 'toggle' }, 9)).toEqual(at(2))
    expect(nextGuide(FOLDED, { kind: 'toggle' }, 9)).toEqual(at(0))
    expect(nextGuide(OPEN, { kind: 'toggle' }, 9)).toEqual(at(0))
  })

  it('answers what depends on a file, and goes back to the questions', () => {
    const impact = nextGuide(OPEN, { kind: 'impact', file: 'src/a.ts' }, 9)
    expect(impact).toEqual({ mode: 'impact', step: 0, playing: false, file: 'src/a.ts' })
    expect(nextGuide(impact, { kind: 'impact', file: null }, 9)).toEqual({
      mode: 'impact',
      step: 0,
      playing: false,
    })
    expect(nextGuide(impact, { kind: 'questions' }, 9)).toEqual(OPEN)
    expect(nextGuide(at(2), { kind: 'questions' }, 9)).toEqual(at(2))
    expect(nextGuide(impact, { kind: 'next' }, 9)).toBe(impact)
    expect(nextGuide(impact, { kind: 'toggle' }, 9)).toEqual(at(0))
  })

  it('advances when a step is up, only while playing, and stops on the last step', () => {
    expect(nextGuide(at(2), { kind: 'advance' }, 9)).toEqual(at(3))
    expect(nextGuide(at(2, false), { kind: 'advance' }, 9)).toEqual(at(2, false))
    expect(nextGuide(at(8), { kind: 'advance' }, 9)).toEqual(at(8, false))
  })
})

describe('tourLength', () => {
  it('adds up the steps’ time, to the minute', () => {
    expect(tourLength(Array(9).fill(12))).toBe('9 steps · about 2 min')
    expect(tourLength([12])).toBe('1 step · about 1 min')
    expect(tourLength([20, 25, 12, 12, 18, 25, 25, 14])).toBe('8 steps · about 3 min')
  })
})
