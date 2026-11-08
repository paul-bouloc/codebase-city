import { describe, expect, it } from 'vitest'
import { decodeResult } from '../data/decode-result'
import type { AnalysisResult } from '../data/generated/AnalysisResult'
import sample from '../data/generated/sample-result.json'
import { indexResult } from '../screen/result-index'
import { buildSearchIndex, normalizeQuery } from './search-index'

const search = buildSearchIndex(indexResult(decodeResult(sample)))

const paths = (query: string) => {
  const { files, folders, symbols } = search.search(query)
  return {
    files: files.hits.map((hit) => hit.path),
    folders: folders.hits.map((hit) => hit.path),
    symbols: symbols.hits.map((hit) => hit.name),
  }
}

describe('buildSearchIndex', () => {
  it('finds files, folders and symbols by name, the best first', () => {
    expect(paths('store')).toEqual({
      files: ['src/core/store.ts', 'tests/store.test.ts'],
      folders: [],
      symbols: ['Store', 'createStore'],
    })
  })

  it('describes a file with its language and its strongest role', () => {
    const [main] = search.search('main').files.hits
    expect(main).toEqual({
      kind: 'file',
      path: 'src/main.ts',
      nameStart: 4,
      positions: [4, 5, 6, 7],
      language: 'typescript',
      languageName: 'TypeScript',
      role: 'entry-point',
      inferred: true,
    })
    expect(search.search('schema').files.hits[0]).toMatchObject({
      role: 'generated',
      inferred: false,
    })
    expect(search.search('view.test').files.hits[0]?.role).toBe('test')
    expect(search.search('tsconfig').files.hits[0]?.role).toBe('config')
    expect(search.search('release').files.hits[0]).toMatchObject({
      language: 'other',
      languageName: 'Shell',
      role: null,
    })
  })

  it('counts a folder’s files at any depth, and never offers the root', () => {
    expect(search.search('src').folders.hits).toEqual([
      { kind: 'folder', path: 'src', nameStart: 0, positions: [0, 1, 2], files: 15 },
    ])
    expect(search.search('core').folders.hits[0]).toMatchObject({ path: 'src/core', files: 5 })
  })

  it('gives a symbol its file and line', () => {
    expect(search.search('tide').symbols.hits).toEqual([
      {
        kind: 'symbol',
        name: 'Tide',
        positions: [0, 1, 2, 3],
        symbolKind: 'enum',
        file: 'src/core/types.ts',
        line: 70,
      },
    ])
  })

  it('matches whole paths when the query holds a slash, and then no symbols', () => {
    expect(paths('core/store')).toEqual({ files: ['src/core/store.ts'], folders: [], symbols: [] })
    const [hit] = search.search('ui/vi').files.hits
    expect(hit?.path).toBe('src/ui/view.ts')
    expect(hit?.positions).toEqual([4, 5, 6, 7, 8])
  })

  it('puts the weightier of two names as good first: more files depend on it', () => {
    const json = structuredClone(decodeResult(sample)) as AnalysisResult
    // tests/view.test.ts becomes tests/view.ts, and more depend on it than on src/ui/view.ts.
    json.files.name[18] = 'view.ts'
    json.files.dependents[18] = 50
    const twins = buildSearchIndex(indexResult(json))
    expect(twins.search('view').files.hits.map((hit) => hit.path)).toEqual([
      'tests/view.ts',
      'src/ui/view.ts',
    ])
  })

  it('counts every match but keeps the best few', () => {
    const { files } = search.search('ts', { files: 2, folders: 3, symbols: 3 })
    expect(files.total).toBeGreaterThan(2)
    expect(files.hits).toHaveLength(2)
  })

  it('finds nothing for an empty query, or one of spaces', () => {
    expect(paths('  ')).toEqual({ files: [], folders: [], symbols: [] })
    expect(search.search('').files.total).toBe(0)
  })

  it('ignores spaces in the query', () => {
    expect(normalizeQuery(' create store ')).toBe('createstore')
    expect(paths('create store').symbols).toEqual(['createStore'])
  })
})

describe('suggest', () => {
  it('offers the closest name to a typo', () => {
    expect(search.suggest('evnets')).toBe('events')
    // `Store` (the class) and `store` (the file) are as close: the first in order wins.
    expect(search.suggest('stroe')).toBe('Store')
    expect(search.suggest('craeteStore')).toBe('createStore')
  })

  it('offers, of names as close, the one most files, folders and symbols carry', () => {
    // One file is `view` (src/ui/view.ts), one class `View`: a tie, settled by order.
    expect(search.suggest('veiw')).toBe('View')
    // A second file named view.ts: `view` is carried twice.
    const json = structuredClone(decodeResult(sample)) as AnalysisResult
    json.files.name[18] = 'view.ts'
    expect(buildSearchIndex(indexResult(json)).suggest('veiw')).toBe('view')
  })

  it('offers nothing when no name is close, or the query is too short', () => {
    expect(search.suggest('zzzzzz')).toBeNull()
    expect(search.suggest('xy')).toBeNull()
    expect(search.suggest('a/b/c')).toBeNull()
  })
})
