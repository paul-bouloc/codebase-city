import { describe, expect, it } from 'vitest'
import { COUNTED_PATHS } from './route'
import { noRouteText, routeSummary } from './route-text'

describe('routeSummary', () => {
  it('counts the steps and the files, and which path of several', () => {
    expect(routeSummary(5, 3, 0)).toEqual({
      steps: '4 steps',
      through: ' through 5 files',
      which: ' · 1 of 3 shortest paths',
    })
  })

  it('leaves the count out for one path, and says one step', () => {
    expect(routeSummary(2, 1, 0)).toEqual({
      steps: '1 step',
      through: ' through 2 files',
      which: null,
    })
  })

  it('stops counting past the paths it goes through', () => {
    expect(routeSummary(3, COUNTED_PATHS + 1, 4).which).toBe(' · 5 of 99+ shortest paths')
  })
})

describe('noRouteText', () => {
  it('says why, then the other way round', () => {
    expect(noRouteText({ kind: 'imports-nothing' }, 'a.ts', 'b.ts', 3)).toBe(
      'a.ts imports no file of the repository. The other way round, b.ts reaches a.ts in 3 steps.',
    )
    expect(noRouteText({ kind: 'imported-by-nothing' }, 'a.ts', 'b.ts', null)).toBe(
      'Nothing imports b.ts. Neither depends on the other.',
    )
  })

  it('names the layers of both files', () => {
    const reason = {
      kind: 'below' as const,
      from: { island: 'base', layer: 1 },
      to: { island: 'workbench', layer: 4 },
    }
    expect(noRouteText(reason, 'strings.ts', 'terminal.ts', 1)).toBe(
      'strings.ts is in base (layer 1), below terminal.ts in workbench (layer 4). The other way round, terminal.ts reaches strings.ts in 1 step.',
    )
  })

  it('counts the files it reaches', () => {
    expect(noRouteText({ kind: 'reaches', files: 1 }, 'a.ts', 'b.ts', null)).toBe(
      'a.ts reaches 1 file; b.ts isn’t one of them. Neither depends on the other.',
    )
  })
})
