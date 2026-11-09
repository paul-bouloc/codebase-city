import { describe, expect, it } from 'vitest'
import { decodeResult } from '../data/decode-result'
import type { AnalysisResult } from '../data/generated/AnalysisResult'
import sample from '../data/generated/sample-result.json'
import type { TourStep } from '../data/generated/TourStep'
import { guideView } from './guide-view'

const result = decodeResult(sample)

function step(kind: TourStep['kind']): TourStep {
  const found = result.tour.steps.find((each) => each.kind === kind)
  if (!found) {
    throw new Error(`no ${kind} step in the sample`)
  }
  return found
}

describe('guideView', () => {
  it('shows nothing for the overview and the layers', () => {
    for (const kind of ['overview', 'layers'] as const) {
      expect(guideView(result, step(kind))).toEqual({
        files: [],
        pinned: [],
        labelled: [],
        folders: [],
        dim: 'none',
        cycle: null,
      })
    }
  })

  it('puts the entry points forward, the first labelled, the rest faded', () => {
    // `src/main.ts`
    expect(guideView(result, step('entryPoints'))).toEqual({
      files: [2],
      pinned: [2],
      labelled: [2],
      folders: [],
      dim: 'all',
      cycle: null,
    })
  })

  it('puts the conductors and the complex files forward', () => {
    // `app.ts` and `legacy.ts`
    expect(guideView(result, step('conductors'))).toMatchObject({ files: [3, 13], labelled: [3] })
    expect(
      guideView(result, { kind: 'complexAreas', files: [5, 9], complexity: 300 }),
    ).toMatchObject({ files: [5, 9], labelled: [5], dim: 'all' })
  })

  it('rings the island of the foundations and fades the others', () => {
    expect(guideView(result, step('foundations'))).toEqual({
      files: [8, 7, 6],
      pinned: [8, 7, 6],
      labelled: [8],
      // `src/core`
      folders: [2],
      dim: 'others',
      cycle: null,
    })
    expect(
      guideView(result, { kind: 'foundations', foundations: [0], island: null }),
    ).toMatchObject({ folders: [], dim: 'all' })
  })

  it('draws the cycle and rings the parks', () => {
    expect(guideView(result, step('cycles'))).toMatchObject({ files: [], dim: 'all', cycle: 0 })
    // `tests`
    expect(guideView(result, step('rest'))).toMatchObject({ folders: [6], dim: 'none' })
  })

  it('puts forward the production files of a package, its largest labelled', () => {
    const json = structuredClone(sample) as unknown as AnalysisResult
    // `src/ui` as a package: its stylesheet is source too, its tests are elsewhere
    json.roles.conductors = { file: [null], dir: [3], count: [9] }
    json.tour.steps = json.tour.steps.map((each) =>
      each.kind === 'conductors' ? { kind: 'conductors', conductors: [0] } : each,
    )
    const withPackage = decodeResult(json)
    expect(guideView(withPackage, { kind: 'conductors', conductors: [0] })).toMatchObject({
      files: [9, 10, 11, 12, 13],
      // `legacy.ts`, 410 lines, stands for the package
      pinned: [13],
      labelled: [13],
    })
  })
})
