import { describe, expect, it } from 'vitest'
import { decodeResult } from '../../../data/decode-result'
import type { AnalysisResult } from '../../../data/generated/AnalysisResult'
import sample from '../../../data/generated/sample-result.json'
import { indexResult } from '../../result-index'
import { fileSheetData, symbolsByFile } from './file-sheet'

const index = indexResult(decodeResult(sample))
const symbols = symbolsByFile(index)
const LOADING = { status: 'loading' } as const

const file = (path: string, at = index) => fileSheetData(at, symbolsByFile(at), path, LOADING)

describe('fileSheetData', () => {
  it('reads a file’s measures, rank, layer and symbols', () => {
    const utils = fileSheetData(index, symbols, 'src/core/utils.ts', LOADING)
    expect(utils).toMatchObject({
      languageName: 'TypeScript',
      language: 'typescript',
      analyzed: true,
      lines: 120,
      complexity: 15,
      // Eighth of the thirteen ranked files: the generated schema, the tests and the facade are
      // left out.
      complexityRank: 8,
      complexityTop: 62,
      repoFiles: 13,
      importers: 4,
      dependents: 11,
      imports: 0,
      layer: { index: 1, of: 3, island: 'core', islandPath: 'src/core' },
      cycles: [],
      symbols: [
        { name: 'MAX_SHIPS', kind: 'constant', line: 2 },
        { name: 'clamp', kind: 'function', line: 5 },
      ],
      githubUrl:
        'https://github.com/acme/harbor/blob/3f2c9a1e8b7d6c5f4a3b2c1d0e9f8a7b6c5d4e3f/src/core/utils.ts',
    })
    expect(utils).not.toHaveProperty('headerComment')
    expect(utils).not.toHaveProperty('shownImporters')
  })

  it('lists the files it imports and those importing it, with how many import each', () => {
    const utils = file('src/core/utils.ts')
    expect(utils?.importerList).toEqual(
      expect.arrayContaining([
        { path: 'src/core/store.ts', importers: 3 },
        { path: 'src/ui/button.ts', importers: 1 },
        { path: 'src/ui/panel.ts', importers: 1 },
        { path: 'src/api/routes.ts', importers: 1 },
      ]),
    )
    expect(utils?.importerList).toHaveLength(4)
    expect(file('src/main.ts')?.importList).toEqual([{ path: 'src/app.ts', importers: 1 }])
  })

  it('gives each role the measure that grounds it, the strongest first', () => {
    const main = file('src/main.ts')
    expect(main?.roles).toEqual([
      {
        role: 'entry-point',
        reason:
          'package.json names it as the package’s main file. It depends on 12 files, directly or not.',
      },
      {
        role: 'conductor',
        reason: 'Depends on 12 files, directly or not, while few depend on it.',
      },
    ])
    expect(main?.headerComment).toBe(
      '// Entry point: wires the store to the view and starts the app.',
    )
    expect(file('src/core/utils.ts')?.roles).toEqual([
      { role: 'foundation', reason: '11 files depend on it, directly or not.' },
    ])
    expect(file('src/core/index.ts')?.roles.map(({ role }) => role)).toEqual(['facade'])
  })

  it('tells generated code, tests and configs from their path', () => {
    expect(file('src/generated/schema.ts')?.pathRole).toBe('generated')
    expect(file('tests/store.test.ts')?.pathRole).toBe('test')
    expect(file('package.json')?.pathRole).toBe('config')
    expect(file('src/core/utils.ts')).not.toHaveProperty('pathRole')
  })

  it('ranks neither tests, generated code nor facades, and keeps their complexity', () => {
    for (const path of ['tests/store.test.ts', 'src/generated/schema.ts', 'src/core/index.ts']) {
      const sheet = file(path)
      expect(sheet).toHaveProperty('complexity')
      expect(sheet).not.toHaveProperty('complexityRank')
      expect(sheet).not.toHaveProperty('repoFiles')
    }
  })

  it('gives no total of dependents that would read smaller than its direct importers', () => {
    // Outside production, the analysis counts no total.
    expect(file('src/generated/schema.ts')).toMatchObject({ importers: 1 })
    expect(file('src/generated/schema.ts')).not.toHaveProperty('dependents')
    // A total below the direct importers (tests among them, a facade seen through) is dropped.
    const json = structuredClone(sample) as unknown as AnalysisResult
    const utils = index.fileAt('src/core/utils.ts') ?? -1
    expect(utils).toBeGreaterThanOrEqual(0)
    json.files.dependents[utils] = 3
    expect(file('src/core/utils.ts', indexResult(json))).not.toHaveProperty('dependents')
    json.files.dependents[utils] = 4
    expect(file('src/core/utils.ts', indexResult(json))).toMatchObject({ dependents: 4 })
  })

  it('tells the size of the cycle a file is in', () => {
    expect(file('src/core/store.ts')?.cycles).toEqual([2])
  })

  it('keeps a file the analyzer does not read to its lines', () => {
    const json = file('package.json')
    expect(json).toMatchObject({ languageName: 'JSON', language: 'other', analyzed: false })
    expect(json).not.toHaveProperty('complexity')
    expect(json).not.toHaveProperty('complexityRank')
    expect(json).not.toHaveProperty('layer')
  })

  it('says when the city groups some of the importers', () => {
    // 21 more files import `utils.ts`: the city draws 20 arcs, and groups the rest.
    const json = structuredClone(sample) as unknown as AnalysisResult
    for (let at = 0; at < 21; at++) {
      json.files.dir.push(2)
      json.files.name.push(`extra${at}.ts`)
      json.files.language.push(0)
      json.files.lines.push(10)
      json.files.complexity.push(1)
      json.files.generated.push(false)
      json.files.scope.push('source')
      json.files.header.push(null)
      json.files.barrel.push(false)
      json.files.dependents.push(0)
      json.files.dependencies.push(1)
      json.edges.from.push(json.files.name.length - 1)
      json.edges.to.push(8)
      json.edges.toDir.push(null)
      json.edges.kind.push('import')
      json.edges.confidence.push('exact')
    }
    expect(file('src/core/utils.ts', indexResult(json))).toMatchObject({
      importers: 25,
      shownImporters: 20,
    })
  })

  it('knows no file outside the result', () => {
    expect(file('src/nowhere.ts')).toBeUndefined()
  })
})
