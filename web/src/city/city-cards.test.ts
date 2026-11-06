import { describe, expect, it } from 'vitest'
import { decodeResult } from '../data/decode-result'
import type { AnalysisResult } from '../data/generated/AnalysisResult'
import sample from '../data/generated/sample-result.json'
import { cityCards } from './city-cards'

const cards = cityCards(decodeResult(sample))

describe('cityCards', () => {
  it('counts direct imports both ways, and gives the strongest role', () => {
    // `utils.ts` is imported by four files and imports none; it is a foundation.
    expect(cards.file('src/core/utils.ts')).toMatchObject({
      language: 'typescript',
      languageName: 'TypeScript',
      complexity: 15,
      incoming: 4,
      outgoing: 0,
      fileRole: 'foundation',
    })
    // `main.ts` is both an entry point and a conductor: the entry point wins.
    expect(cards.file('src/main.ts')).toMatchObject({
      incoming: 0,
      outgoing: 1,
      fileRole: 'entry-point',
    })
  })

  it('names a language the analyzer does not read, without a complexity', () => {
    const card = cards.file('package.json')
    expect(card).toMatchObject({ language: 'other', languageName: 'JSON', lines: 30 })
    expect(card).not.toHaveProperty('complexity')
    expect(card).not.toHaveProperty('fileRole')
  })

  it('ranks only the most complex files', () => {
    expect(cards.file('src/ui/legacy.ts')?.complexityTop).toBeLessThanOrEqual(10)
    expect(cards.file('src/core/index.ts')).not.toHaveProperty('complexityTop')
  })

  it('counts an island by its own files, and a parcel by its subtree', () => {
    // `src` is split into islands: its island holds `main.ts` and `app.ts` only.
    expect(cards.folder('src')).toEqual({ path: 'src', files: 2, layer: 3 })
    expect(cards.folder('src/core')).toEqual({ path: 'src/core', files: 5, layer: 1 })
    // The root's island has no production code, so no layer.
    expect(cards.folder('/')).toEqual({ path: '/', files: 2 })

    // `utils.ts` moved to `src/core/sub`, a folder inside the `core` island
    const json = structuredClone(sample) as unknown as AnalysisResult
    json.dirs.parent.push(2)
    json.dirs.name.push('sub')
    json.dirs.island.push(2)
    json.files.dir[8] = 8
    // Not decoded: the layout would need a parcel for the new folder, which the cards never read.
    const moved = cityCards(json)
    expect(moved.folder('src/core/sub')).toEqual({
      path: 'src/core/sub',
      files: 1,
      layer: 1,
      island: 'core',
    })
    expect(moved.folder('src/core')?.files).toBe(5)
  })

  it('knows nothing of a path not in the result', () => {
    expect(cards.file('nowhere.ts')).toBeUndefined()
    expect(cards.folder('nowhere')).toBeUndefined()
  })
})
