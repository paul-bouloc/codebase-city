import { describe, expect, it } from 'vitest'
import { decodeResult } from '../data/decode-result'
import type { AnalysisResult } from '../data/generated/AnalysisResult'
import type { PackageKind } from '../data/generated/PackageKind'
import type { Packages } from '../data/generated/Packages'
import sample from '../data/generated/sample-result.json'
import { guideUnits, unitFolders } from './guide-units'

const result = decodeResult(sample)

// Folders of the sample: 0 `/`, 1 `src`, 2 `src/core`, 3 `src/ui`, 4 `src/api`,
// 5 `src/generated`, 6 `tests`, 7 `scripts`; each an island.
function monorepo(
  rows: Partial<Packages> & { dir: number[] },
  change: Partial<AnalysisResult> = {},
): AnalysisResult {
  const none = () => rows.dir.map(() => null)
  return {
    ...result,
    packages: {
      name: rows.dir.map((dir) => `pkg-${dir}`),
      kind: rows.dir.map((): PackageKind => 'library'),
      framework: none(),
      manifest: none(),
      group: none(),
      codeFiles: rows.dir.map(() => 1),
      entry: none(),
      routes: none(),
      routeCount: rows.dir.map(() => 0),
      apiRouteCount: rows.dir.map(() => 0),
      ...rows,
    },
    packageGroups: { prefix: ['billing'], linked: [false] },
    ...change,
  }
}

describe('guideUnits', () => {
  it('makes a unit of each app, and one of the apps of a group, the largest first', () => {
    const repo = monorepo({
      dir: [2, 3, 4],
      kind: ['app', 'app', 'app'],
      framework: ['nextjs', null, null],
      group: [null, 0, 0],
      codeFiles: [40, 30, 20],
    })
    const units = guideUnits(repo, {
      kind: 'applications',
      units: [
        { group: null, apps: [0], files: 40 },
        { group: 0, apps: [1, 2], files: 50 },
      ],
      appFiles: 90,
    })
    expect(units).toEqual([
      {
        kind: 'group',
        packages: [1, 2],
        packageKind: 'app',
        group: 0,
        folders: [3, 4],
        host: null,
        framework: null,
        codeFiles: 50,
        importers: null,
      },
      {
        kind: 'app',
        packages: [0],
        packageKind: 'app',
        group: null,
        folders: [2],
        host: null,
        framework: 'nextjs',
        codeFiles: 40,
        importers: null,
      },
    ])
    expect(unitFolders(units)).toEqual([3, 4, 2])
  })

  it('gives the libraries the step counts their importers', () => {
    const repo = monorepo({ dir: [2, 3, 4], codeFiles: [5, 9, 30] })
    const units = guideUnits(repo, {
      kind: 'libraries',
      mostImported: [0, 1],
      importers: [7, 3],
      largest: 2,
      singleApp: [],
      unused: [],
    })
    expect(units.map((unit) => [unit.packages, unit.importers])).toEqual([
      [[2], null],
      [[1], 3],
      [[0], 7],
    ])
  })

  it('shows the library and the apps a link names, each once', () => {
    const repo = monorepo({ dir: [2, 3, 4], kind: ['library', 'app', 'app'] })
    const units = guideUnits(repo, {
      kind: 'appLinks',
      appImports: 0,
      shared: [
        { library: 0, apps: [1, 2], files: 4, typeOnly: 0 },
        { library: 0, apps: [2], files: 1, typeOnly: 0 },
      ],
    })
    expect(units.map((unit) => unit.packages[0])).toEqual([0, 1, 2])
  })

  it('stands the root package on the islands no other package holds', () => {
    const repo = monorepo({ dir: [0, 2], kind: ['app', 'library'] })
    const units = guideUnits(repo, { kind: 'otherApps', apps: [0, 1] })
    expect(units[0]).toMatchObject({
      kind: 'root',
      packageKind: 'app',
      folders: [0, 1, 3, 4, 5, 6, 7],
    })
  })

  it('leaves out the root package when it holds every island', () => {
    const repo = monorepo({ dir: [0], kind: ['app'] })
    expect(guideUnits(repo, { kind: 'otherApps', apps: [0] })).toEqual([])
  })

  it('stands a package inside another on its parcel, and names the one that holds it', () => {
    // `src/generated` is a parcel of the island `src`, a package
    const repo = monorepo(
      { dir: [1, 5], kind: ['app', 'library'] },
      { islands: { dir: [0, 1, 6, 7], layer: [null, null, null, null] } },
    )
    const units = guideUnits(repo, { kind: 'otherApps', apps: [1] })
    expect(units).toMatchObject([{ kind: 'library', folders: [5], host: 0 }])
  })

  it('puts a package on an island of its own inside none, even under the root package', () => {
    // `src/core` is an island, under `src`, which the root package holds
    const repo = monorepo({ dir: [0, 2], kind: ['app', 'library'] })
    const units = guideUnits(repo, { kind: 'otherApps', apps: [1] })
    expect(units).toMatchObject([{ kind: 'library', folders: [2], host: null }])
  })

  it('shows nothing for a step without packages', () => {
    expect(guideUnits(result, { kind: 'entryPoints', entries: [0] })).toEqual([])
  })
})
