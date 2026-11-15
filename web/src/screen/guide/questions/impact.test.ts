import { describe, expect, it } from 'vitest'
import { decodeResult } from '../../../data/decode-result'
import sample from '../../../data/generated/sample-result.json'
import { indexResult, type ResultIndex } from '../../result-index'
import { ISLAND_ROWS, impactIslandNames, impactOf } from './impact'

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

  it('finds nothing for a file nothing imports', () => {
    const impact = impactOf(chain, ['a', 'b'], 5)
    expect(impact.dependents).toEqual([])
    expect(impact.islands).toEqual([
      { name: 'a', count: 0 },
      { name: 'b', count: 0 },
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
  const names = impactIslandNames(index)

  it('names the root island after the repository', () => {
    expect(names).toHaveLength(index.result.islands.dir.length)
    const root = index.result.islands.dir.findIndex((dir) => index.folderPaths[dir] === '/')
    if (root >= 0) {
      expect(names[root]).toBe(index.result.repo.name)
    }
  })

  it('counts as direct the files the sheet says import it', () => {
    index.filePaths.forEach((_, file) => {
      const impact = impactOf(index, names, file)
      expect(impact.direct).toBe(index.importers[file]?.length)
      const onIslands = impact.islands.reduce((sum, row) => sum + row.count, 0)
      expect(onIslands + (impact.otherIslands?.count ?? 0)).toBeLessThanOrEqual(
        impact.dependents.length,
      )
    })
  })
})
