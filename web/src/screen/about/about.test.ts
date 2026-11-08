import { describe, expect, it } from 'vitest'
import { decodeResult } from '../../data/decode-result'
import type { AnalysisResult } from '../../data/generated/AnalysisResult'
import sample from '../../data/generated/sample-result.json'
import { indexResult } from '../result-index'
import { aboutData } from './about'

const index = indexResult(decodeResult(sample))

describe('aboutData', () => {
  it('counts files, skipped files, languages and resolved imports', () => {
    expect(aboutData(index)).toEqual({
      analyzedFiles: 20,
      generatedFiles: 1,
      skipped: [
        { reason: 'vendored', files: 3 },
        { reason: 'minified', files: 1 },
        { reason: 'binary', files: 2 },
        { reason: 'too deep', files: 1 },
      ],
      languages: [
        { language: 'typescript', files: 16 },
        { language: 'css', files: 1 },
        { language: 'other', files: 3 },
      ],
      // Imports of outside packages are not the repository's to resolve.
      resolvedImports: 26 / 27,
      // Shell has no imports to miss.
      unanalyzed: [],
      commit: '3f2c9a1',
      commitUrl: 'https://github.com/acme/harbor/commit/3f2c9a1e8b7d6c5f4a3b2c1d0e9f8a7b6c5d4e3f',
      analyzer: 'analyzer 0.1.0',
    })
  })

  it('names Python and Go with their own colour, not as other', () => {
    const json = structuredClone(sample) as unknown as AnalysisResult
    json.languages[0] = 'Python'
    json.languages[3] = 'Go'
    expect(aboutData(indexResult(json)).languages).toEqual([
      { language: 'python', files: 16 },
      { language: 'css', files: 1 },
      { language: 'go', files: 1 },
      { language: 'other', files: 2 },
    ])
  })

  it('lists code in a language the analyzer does not read', () => {
    const json = structuredClone(sample) as unknown as AnalysisResult
    json.languages[3] = 'Rust'
    expect(aboutData(indexResult(json)).unanalyzed).toEqual([{ name: 'Rust', files: 1 }])
  })
})
