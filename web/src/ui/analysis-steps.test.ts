import { describe, expect, it } from 'vitest'
import { progressStatus, stepStates } from './analysis-steps'

describe('stepStates', () => {
  it('marks the steps before, at and after the current one', () => {
    expect(stepStates('parsing', 'running')).toEqual([
      'done',
      'done',
      'done',
      'current',
      'upcoming',
      'upcoming',
      'upcoming',
    ])
  })

  it('marks where a build failed or was cancelled', () => {
    expect(stepStates('downloading', 'failed').slice(0, 3)).toEqual(['done', 'failed', 'upcoming'])
    expect(stepStates('queued', 'cancelled')[0]).toBe('cancelled')
  })

  it('marks every step done once the city is built', () => {
    expect(stepStates('building', 'done').every((state) => state === 'done')).toBe(true)
  })
})

describe('progressStatus', () => {
  it('stays Building while waiting on GitHub or reconnecting', () => {
    expect(progressStatus('queued', 'running')).toBe('queued')
    expect(progressStatus('downloading', 'paused')).toBe('building')
    expect(progressStatus('parsing', 'reconnecting')).toBe('building')
    expect(progressStatus('mapping', 'failed')).toBe('failed')
  })
})
