import { describe, expect, it } from 'vitest'
import type { StepText } from './tour/tour-spans'
import {
  clockDue,
  clockSpent,
  MAX_STEP_SECONDS,
  MIN_STEP_SECONDS,
  pauseClock,
  resumeClock,
  startClock,
  stepSeconds,
} from './tour-clock'

const text = (words: number, chips: string[] = []): StepText => ({
  text: [Array(words).fill('word').join(' ')],
  closer: chips.map((chip) => ({ target: { kind: 'next' }, spans: [chip] })),
})

describe('stepSeconds', () => {
  it('gives a short step its 12 seconds', () => {
    expect(stepSeconds(text(10))).toBe(MIN_STEP_SECONDS)
  })

  it('gives a long text more time: 4 s to look, then 3.5 words a second', () => {
    // 4 + 42 / 3.5 = 16
    expect(stepSeconds(text(42))).toBe(16)
  })

  it('counts the chips’ words, and a name as one word', () => {
    const step: StepText = {
      text: [
        'Everything rests on ',
        { kind: 'folder', path: 'src/vs/base' },
        ' and words',
        ...Array(36).fill(' w'),
      ],
      closer: [{ target: { kind: 'next' }, spans: ['three more words'] }],
    }
    // 3 + 1 + 2 + 36 + 3 = 45 words: 4 + 45 / 3.5 ≈ 16.9
    expect(stepSeconds(step)).toBe(17)
  })

  it('never goes past 25 seconds', () => {
    expect(stepSeconds(text(200, ['a b c']))).toBe(MAX_STEP_SECONDS)
  })
})

describe('the step clock', () => {
  it('is due its seconds after it starts', () => {
    expect(clockDue(startClock(12, 1000))).toBe(13_000)
  })

  it('keeps what was left across a pause: no step is skipped, none starts over', () => {
    const paused = pauseClock(startClock(12, 0), 5000)
    expect(paused).toEqual({ left: 7000, since: null })
    expect(clockDue(paused)).toBeNull()
    expect(clockDue(resumeClock(paused, 60_000))).toBe(67_000)
  })

  it('pauses past its time with nothing left, and resumes to be due at once', () => {
    const paused = pauseClock(startClock(12, 0), 20_000)
    expect(paused.left).toBe(0)
    expect(clockDue(resumeClock(paused, 30_000))).toBe(30_000)
  })

  it('is spent once stopped with nothing left, not while it runs', () => {
    expect(clockSpent(pauseClock(startClock(12, 0), 20_000))).toBe(true)
    expect(clockSpent(pauseClock(startClock(12, 0), 5000))).toBe(false)
    expect(clockSpent(startClock(12, 0))).toBe(false)
  })

  it('leaves a stopped clock stopped, and a running one running', () => {
    const paused = pauseClock(startClock(12, 0), 1000)
    expect(pauseClock(paused, 9000)).toBe(paused)
    const running = startClock(12, 0)
    expect(resumeClock(running, 9000)).toBe(running)
  })
})
