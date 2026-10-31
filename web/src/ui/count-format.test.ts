import { describe, expect, it } from 'vitest'
import { exactCount, fileSize, percent, shortCount } from './count-format'

describe('shortCount', () => {
  it('writes small counts in full', () => {
    expect(shortCount(0)).toBe('0')
    expect(shortCount(999)).toBe('999')
  })

  it('shortens large counts to four characters at most', () => {
    const samples = [1_204, 9_999, 12_345, 123_456, 999_999, 1_234_567, 98_765_432]
    expect(samples.map(shortCount)).toEqual(['1.2k', '10k', '12k', '120k', '1m', '1.2m', '99m'])
    for (const sample of samples) {
      expect(shortCount(sample).length).toBeLessThanOrEqual(4)
    }
  })
})

describe('exactCount', () => {
  it('groups thousands', () => {
    expect(exactCount(1_204)).toBe('1,204')
  })
})

describe('percent', () => {
  it('never rounds a part to nothing or to everything', () => {
    expect(percent(0.004)).toBe('<1%')
    expect(percent(0.996)).toBe('>99%')
    expect(percent(0.92)).toBe('92%')
    expect(percent(0)).toBe('0%')
    expect(percent(1)).toBe('100%')
  })
})

describe('fileSize', () => {
  it('writes bytes, kilobytes or megabytes', () => {
    expect(fileSize(40)).toBe('40 B')
    expect(fileSize(8400)).toBe('8.4 KB')
    expect(fileSize(2_350_000)).toBe('2.4 MB')
  })
})
