import { describe, expect, it } from 'vitest'
import { decodeResult } from '../data/decode-result'
import type { AnalysisResult } from '../data/generated/AnalysisResult'
import sample from '../data/generated/sample-result.json'
import { repoContents } from './legend'
import { indexResult } from './result-index'

const index = indexResult(decodeResult(sample))
const NO_LINKS = { bridges: 0, ferries: 0, inPorts: 0, hidden: 0 }

describe('repoContents', () => {
  it('counts files by language, tests apart', () => {
    const contents = repoContents(index, NO_LINKS)
    expect(contents.testFiles).toBe(2)
    expect(contents.languages).toEqual(
      expect.arrayContaining([
        { language: 'typescript', files: 14 },
        { language: 'css', files: 1 },
        { language: 'other', files: 3 },
      ]),
    )
    expect(contents.landmarks.size).toBe(0)
  })

  it('lists the ways links are drawn and the places the city has', () => {
    expect(repoContents(index, NO_LINKS).places).toEqual(new Set(['cycle', 'park']))
    const drawn = repoContents(index, { bridges: 2, ferries: 1, inPorts: 3, hidden: 0 })
    expect(drawn.places).toEqual(new Set(['bridge', 'ferry', 'port', 'cycle', 'park']))
  })

  it('lists imports up the layers only when there are some', () => {
    const json = structuredClone(sample) as unknown as AnalysisResult
    json.links.upward[0] = 1
    expect(repoContents(indexResult(json), NO_LINKS).places.has('upward')).toBe(true)
  })
})
