import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HoverTiming } from './hover-timing'

/** Every call, as `highlight:a` or `card:-` for none, with the time it came at. */
function record() {
  const calls: string[] = []
  const timing = new HoverTiming<string>(
    {
      highlight: (target) => calls.push(`${Date.now()} highlight:${target ?? '-'}`),
      card: (target) => calls.push(`${Date.now()} card:${target ?? '-'}`),
    },
    (a, b) => a === b,
  )
  return { calls, timing }
}

describe('HoverTiming', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('lights a target up at 120 ms and shows its card at 300 ms', () => {
    const { calls, timing } = record()
    timing.point('a')
    vi.advanceTimersByTime(119)
    expect(calls).toEqual([])
    vi.advanceTimersByTime(1000)
    expect(calls).toEqual(['120 highlight:a', '300 card:a'])
  })

  it('lets the card go 100 ms after the pointer leaves', () => {
    const { calls, timing } = record()
    timing.point('a')
    vi.advanceTimersByTime(500)
    timing.point(null)
    vi.advanceTimersByTime(1000)
    expect(calls).toEqual(['120 highlight:a', '300 card:a', '500 highlight:-', '600 card:-'])
  })

  it('shows nothing for a target left before its time', () => {
    const { calls, timing } = record()
    timing.point('a')
    vi.advanceTimersByTime(100)
    timing.point('b')
    vi.advanceTimersByTime(1000)
    expect(calls).toEqual(['100 highlight:-', '220 highlight:b', '400 card:b'])
  })

  it('moves from one card to the next', () => {
    const { calls, timing } = record()
    timing.point('a')
    vi.advanceTimersByTime(500)
    timing.point('b')
    vi.advanceTimersByTime(1000)
    expect(calls.slice(2)).toEqual([
      '500 highlight:-',
      '600 card:-',
      '620 highlight:b',
      '800 card:b',
    ])
  })

  it('keeps the card of a target the pointer comes back to in time', () => {
    const { calls, timing } = record()
    timing.point('a')
    vi.advanceTimersByTime(500)
    timing.point(null)
    vi.advanceTimersByTime(50)
    timing.point('a')
    vi.advanceTimersByTime(1000)
    expect(calls.slice(2)).toEqual(['500 highlight:-', '670 highlight:a'])
  })

  it('clears everything at once when the camera moves', () => {
    const { calls, timing } = record()
    timing.point('a')
    vi.advanceTimersByTime(500)
    timing.clear()
    vi.advanceTimersByTime(1000)
    expect(calls.slice(2)).toEqual(['500 highlight:-', '500 card:-'])
  })

  it('does nothing when the pointer stays on the same target', () => {
    const { calls, timing } = record()
    timing.point('a')
    vi.advanceTimersByTime(200)
    timing.point('a')
    vi.advanceTimersByTime(1000)
    expect(calls).toEqual(['120 highlight:a', '300 card:a'])
  })
})
