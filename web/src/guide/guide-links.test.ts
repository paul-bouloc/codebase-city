import { describe, expect, it } from 'vitest'
import type { TourStep } from '../data/generated/TourStep'
import { guideLinks } from './guide-links'
import type { GuideUnit } from './guide-units'

function unit(packages: number[], folders = [packages[0] ?? 0]): GuideUnit {
  return {
    kind: packages.length > 1 ? 'group' : 'app',
    packages,
    packageKind: 'app',
    group: packages.length > 1 ? 0 : null,
    folders,
    host: null,
    framework: null,
    codeFiles: 1,
    importers: null,
  }
}

const step = (shared: Extract<TourStep, { kind: 'appLinks' }>['shared']): TourStep => ({
  kind: 'appLinks',
  appImports: 0,
  shared,
})

describe('guideLinks', () => {
  it('links each unit of apps to the library it shares, the most files first', () => {
    // Units: web (0), the library (1), api (2), mobile (3)
    const units = [unit([0]), unit([5]), unit([1]), unit([2])]
    const links = guideLinks(
      step([{ library: 5, apps: [0, 1, 2], files: [612, 300, 80], typeOnly: [470, 0, 80] }]),
      units,
    )
    expect(links).toEqual([
      { from: 0, to: 1, files: 612, typeOnly: 470 },
      { from: 2, to: 1, files: 300, typeOnly: 0 },
      { from: 3, to: 1, files: 80, typeOnly: 80 },
    ])
  })

  it('makes one link of a group, with the files of all its apps', () => {
    const units = [unit([0, 1, 2], [0, 1, 2]), unit([5]), unit([3])]
    const links = guideLinks(
      step([{ library: 5, apps: [3, 0, 2], files: [50, 40, 10], typeOnly: [0, 4, 1] }]),
      units,
    )
    expect(links).toEqual([
      { from: 0, to: 1, files: 50, typeOnly: 5 },
      { from: 2, to: 1, files: 50, typeOnly: 0 },
    ])
  })

  it('leaves out what the step shows nothing of, and other steps', () => {
    const units = [unit([0]), unit([5])]
    expect(
      guideLinks(
        step([
          { library: 5, apps: [0, 9], files: [2, 1], typeOnly: [0, 0] },
          { library: 8, apps: [0, 9], files: [2, 1], typeOnly: [0, 0] },
        ]),
        units,
      ),
    ).toEqual([{ from: 0, to: 1, files: 2, typeOnly: 0 }])
    expect(guideLinks({ kind: 'otherApps', apps: [0] }, units)).toEqual([])
  })
})
