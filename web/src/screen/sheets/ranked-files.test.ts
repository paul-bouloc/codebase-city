import { describe, expect, it } from 'vitest'
import { rankedRows } from './ranked-files'

const rows = Array.from({ length: 12 }, (_, index) => ({
  path: `src/file${index}.ts`,
  importers: (index * 7) % 13,
}))

describe('rankedRows', () => {
  it('sorts by importers, the most depended on first', () => {
    const { shown } = rankedRows(rows, true)
    const counts = shown.map(({ importers }) => importers)
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
  })

  it('stops at 8 until the list is expanded, then shows every row', () => {
    expect(rankedRows(rows, false).shown).toHaveLength(8)
    expect(rankedRows(rows, true).shown).toHaveLength(12)
    expect(rankedRows(rows, false).total).toBe(12)
  })

  it('gives the largest count, for the bars', () => {
    expect(rankedRows(rows, false).max).toBe(12)
    expect(rankedRows([], false)).toEqual({ shown: [], total: 0, max: 0 })
  })
})
