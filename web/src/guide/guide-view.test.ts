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
  it('puts forward the manifest that declares what the project builds on', () => {
    // `react`, declared by `package.json`, the first file
    const view = guideView(result, step('builtOn'))
    expect(view.files).toEqual([0])
    expect(view.pinned).toEqual([0])
  })

  it('rings the folders of the examples', () => {
    const view = guideView(result, {
      kind: 'examplesAndTests',
      folders: [6],
      examples: [12],
      tests: 3,
    })
    expect(view.folders).toEqual([6])
    expect(view.dim).toBe('others')
  })

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

  it('rings the islands of the packages a step of a monorepo names, the rest faded', () => {
    // Packages at `src/core`, `src/ui` and `src/api`
    const monorepo: AnalysisResult = {
      ...result,
      packages: { ...result.packages, dir: [2, 3, 4] },
    }
    const ringed = (folders: number[]) => ({
      files: [],
      pinned: [],
      labelled: [],
      folders,
      dim: 'others',
      cycle: null,
    })
    expect(
      guideView(monorepo, {
        kind: 'applications',
        units: [{ group: null, apps: [0, 1], files: 8 }],
        appFiles: 8,
      }),
    ).toEqual(ringed([2, 3]))
    expect(
      guideView(monorepo, {
        kind: 'libraries',
        mostImported: [2],
        importers: [2],
        largest: 2,
        singleApp: [],
        unused: [],
      }),
    ).toEqual(ringed([4]))
    expect(
      guideView(monorepo, {
        kind: 'appLinks',
        appImports: 0,
        shared: [{ library: 2, apps: [0, 1], files: 4, typeOnly: 0 }],
      }),
    ).toEqual(ringed([4, 2, 3]))
    expect(
      guideView(monorepo, { kind: 'insidePackage', package: 0, dirs: [5], files: [3] }),
    ).toEqual(ringed([5]))
    expect(
      guideView(monorepo, {
        kind: 'consumers',
        folders: [{ dir: 6, folders: 3, imports: 9 }],
        package: 2,
      }),
    ).toEqual(ringed([6]))
  })

  it('rings the islands a root package owns, and a package inside another by its folder', () => {
    // The root is a package (`.` of go.work); `src/core`, `src/ui` and `src/generated` are
    // packages inside it
    const monorepo: AnalysisResult = {
      ...result,
      packages: { ...result.packages, dir: [0, 2, 3, 5] },
    }
    const view = guideView(monorepo, { kind: 'otherApps', apps: [0, 3] })
    // The root owns `/`, `src`, `src/api`, `tests` and `scripts`; `src/generated` is its own
    expect(view.folders).toEqual([0, 1, 4, 6, 7, 5])
    expect(view.dim).toBe('others')
  })
})
