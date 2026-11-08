import { describe, expect, it } from 'vitest'
import { highlightRuns, type SearchResults, searchOptions } from './search-data'

describe('highlightRuns', () => {
  it('marks the matched characters, run by run', () => {
    expect(highlightRuns('textModel.ts', [0, 1, 2, 3, 4])).toEqual([
      { text: 'textM', match: true },
      { text: 'odel.ts', match: false },
    ])
    expect(highlightRuns('textModel.ts', [0, 4, 8])).toEqual([
      { text: 't', match: true },
      { text: 'ext', match: false },
      { text: 'M', match: true },
      { text: 'ode', match: false },
      { text: 'l', match: true },
      { text: '.ts', match: false },
    ])
  })

  it('cuts a part of the text, positions counted in the whole', () => {
    expect(highlightRuns('src/model.ts', [4, 5], 4)).toEqual([
      { text: 'mo', match: true },
      { text: 'del.ts', match: false },
    ])
    expect(highlightRuns('src/model.ts', [1], 0, 3)).toEqual([
      { text: 's', match: false },
      { text: 'r', match: true },
      { text: 'c', match: false },
    ])
    expect(highlightRuns('abc', [], 1, 1)).toEqual([])
  })
})

describe('searchOptions', () => {
  it('lists files, then folders, then symbols', () => {
    const results: SearchResults = {
      files: {
        total: 1,
        hits: [
          {
            kind: 'file',
            path: 'a.ts',
            nameStart: 0,
            positions: [],
            language: 'typescript',
            languageName: 'TypeScript',
            role: null,
            inferred: false,
          },
        ],
      },
      folders: {
        total: 1,
        hits: [{ kind: 'folder', path: 'a', nameStart: 0, positions: [], files: 1 }],
      },
      symbols: {
        total: 1,
        hits: [
          { kind: 'symbol', name: 'A', positions: [], symbolKind: 'class', file: 'a.ts', line: 1 },
        ],
      },
    }
    expect(searchOptions(results).map((hit) => hit.kind)).toEqual(['file', 'folder', 'symbol'])
  })
})
