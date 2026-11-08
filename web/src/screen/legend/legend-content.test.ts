import { describe, expect, it } from 'vitest'
import { legendContent, type RepoContents } from './legend-content'

const repo = (overrides: Partial<RepoContents> = {}): RepoContents => ({
  languages: [
    { language: 'other', files: 300 },
    { language: 'css', files: 2 },
    { language: 'typescript', files: 9000 },
    { language: 'javascript', files: 0 },
  ],
  testFiles: 0,
  places: new Set(),
  landmarks: new Set(),
  ...overrides,
})

describe('legendContent', () => {
  it('lists only the languages the repository has, the largest first and other last', () => {
    const { languages } = legendContent(repo())
    expect(languages.map(({ language }) => language)).toEqual(['typescript', 'css', 'other'])
  })

  it('writes the share of each language, never 0%', () => {
    const { languages } = legendContent(repo())
    expect(languages.map(({ share }) => share)).toEqual(['97%', '<1%', '3%'])
  })

  it('shows the tests row only when there are tests', () => {
    expect(legendContent(repo()).tests).toBe(false)
    expect(legendContent(repo({ testFiles: 12 })).tests).toBe(true)
  })

  it('keeps the legend order for places and landmarks, whatever the input order', () => {
    const content = legendContent(
      repo({
        places: new Set(['park', 'upward', 'bridge']),
        landmarks: new Set(['config', 'entry-point']),
      }),
    )
    expect(content.places).toEqual(['bridge', 'upward', 'park'])
    expect(content.landmarks).toEqual(['entry-point', 'config'])
  })

  it('is empty for an empty repository', () => {
    expect(legendContent(repo({ languages: [] }))).toEqual({
      languages: [],
      tests: false,
      places: [],
      landmarks: [],
    })
  })
})
