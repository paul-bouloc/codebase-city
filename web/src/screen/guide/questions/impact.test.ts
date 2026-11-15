import { describe, expect, it } from 'vitest'
import { decodeResult } from '../../../data/decode-result'
import sample from '../../../data/generated/sample-result.json'
import { indexResult, type ResultIndex } from '../../result-index'
import { type TourContext, tourContext } from '../tour/tour-spans'
import { ISLAND_ROWS, impactOf as impactIn } from './impact'

/** A city of files whose importers, islands and scopes are written by hand. */
function city(
  importers: number[][],
  island: (number | null)[],
  scope: string[] = importers.map(() => 'source'),
): ResultIndex {
  return {
    importers,
    filePaths: importers.map((_, file) => `f${file}.ts`),
    islandOfFile: (file: number) => island[file] ?? null,
    result: { files: { scope } },
  } as unknown as ResultIndex
}

/** The impact of `file` in a hand-written city, its islands named `names`. */
function impactOf(index: ResultIndex, names: string[], file: number) {
  const islandFiles = names.map(() => 0)
  index.filePaths.forEach((_, each) => {
    const at = index.islandOfFile(each)
    if (at !== null) {
      islandFiles[at] = (islandFiles[at] ?? 0) + 1
    }
  })
  const context: TourContext = { index, islandNames: names, islandFiles }
  return impactIn(context, file)
}

describe('impactOf', () => {
  // 0 ← 1 ← 2 ← 3, and 4 imports 0 and 2; 5 imports nothing.
  const chain = city([[1, 4], [2], [3, 4], [], [], []], [0, 0, 1, 1, null, 1])

  it('counts the files that import it, then the ones that reach it through them', () => {
    const impact = impactOf(chain, ['a', 'b'], 0)
    expect([...impact.dependents].sort()).toEqual([1, 2, 3, 4])
    expect(impact.direct).toBe(2)
    expect(impact.files).toBe(6)
  })

  it('counts a file on an island, not one on none', () => {
    const impact = impactOf(chain, ['a', 'b'], 0)
    expect(impact.islands).toEqual([
      { name: 'b', count: 2 },
      { name: 'a', count: 1 },
    ])
    expect(impact.otherIslands).toBeNull()
  })

  it('goes round a cycle once, the file itself left out', () => {
    const loop = city([[2], [0], [1]], [0, 0, 0])
    const impact = impactOf(loop, ['a'], 0)
    expect([...impact.dependents].sort()).toEqual([1, 2])
    expect(impact.direct).toBe(1)
  })

  it('finds nothing for a file nothing imports, and lists the largest island first', () => {
    const impact = impactOf(chain, ['a', 'b'], 5)
    expect(impact.dependents).toEqual([])
    expect(impact.islands).toEqual([
      { name: 'b', count: 0 },
      { name: 'a', count: 0 },
    ])
  })

  it('counts the tests among the dependents', () => {
    const tested = city([[1, 2], [], []], [0, 0, 0], ['source', 'source', 'test'])
    expect(impactOf(tested, ['a'], 0).tests).toBe(1)
  })

  it('sums the islands past the rows in one, and keeps a row for an empty island only if free', () => {
    const islands = ISLAND_ROWS + 2
    const names = Array.from({ length: islands }, (_, at) => `i${at}`)
    // File 0 is imported by one file on each island but the last.
    const importers = [Array.from({ length: islands - 1 }, (_, at) => at + 1)]
    for (let at = 1; at < islands; at++) {
      importers.push([])
    }
    const impact = impactOf(city(importers, [islands - 1, ...names.map((_, at) => at)]), names, 0)
    expect(impact.islands).toHaveLength(ISLAND_ROWS)
    expect(impact.islands.every((row) => row.count === 1)).toBe(true)
    expect(impact.otherIslands).toEqual({ islands: 1, count: 1 })
  })
})

describe('impact on the sample', () => {
  const index = indexResult(decodeResult(sample))
  const context = tourContext(index)

  it('counts as direct the files the sheet says import it', () => {
    index.filePaths.forEach((_, file) => {
      const impact = impactIn(context, file)
      expect(impact.direct).toBe(index.importers[file]?.length)
      const onIslands = impact.islands.reduce((sum, row) => sum + row.count, 0)
      expect(onIslands + (impact.otherIslands?.count ?? 0)).toBeLessThanOrEqual(
        impact.dependents.length,
      )
    })
  })
})
