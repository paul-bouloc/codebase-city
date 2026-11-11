import { describe, expect, it } from 'vitest'
import { decodeResult } from '../decode-result'
import type { AnalysisResult } from '../generated/AnalysisResult'
import sample from '../generated/sample-result.json'

type Json = Record<keyof AnalysisResult, unknown> & {
  workspaces: unknown
  packages: Record<string, unknown[]>
  packageGroups: Record<string, unknown[]>
  externals: Record<string, unknown[]>
}

/** The sample with `tests` and `scripts` as two packages of an npm workspace, grouped. */
function withPackages(): Json {
  const json = structuredClone(sample) as unknown as Json
  json.workspaces = [{ kind: 'npm', manifest: 0 }]
  json.packages = {
    dir: [6, 7],
    name: ['acme-tests', 'acme-scripts'],
    kind: ['library', 'app'],
    framework: [null, 'nextjs'],
    manifest: [null, 0],
    group: [0, 0],
    codeFiles: [0, 0],
    entry: [null, 19],
    routes: [null, 7],
    routeCount: [0, 3],
    apiRouteCount: [0, 1],
  }
  json.packageGroups = { prefix: ['acme'], linked: [false] }
  return json
}

function decodeChanged(change: (json: Json) => void) {
  const json = withPackages()
  change(json)
  return () => decodeResult(json)
}

describe('decodePackages', () => {
  it('accepts the sample, without a workspace, and its externals', () => {
    const result = decodeResult(sample)
    expect(result.workspaces).toEqual([])
    expect(result.packages.dir).toEqual([])
    expect(result.externals.name).toEqual(['axios', 'react'])
  })

  it('accepts packages of a workspace, grouped', () => {
    const result = decodeResult(withPackages())
    expect(result.workspaces.map((workspace) => workspace.kind)).toEqual(['npm'])
    expect(result.packages.framework[1]).toBe('nextjs')
    expect(result.packageGroups.prefix).toEqual(['acme'])
  })

  it('rejects unknown kinds and frameworks', () => {
    expect(decodeChanged((json) => (json.workspaces = [{ kind: 'yarn', manifest: 0 }]))).toThrow(
      'workspaces[0].kind is not a workspace kind',
    )
    expect(
      decodeChanged(
        (json) =>
          (json.workspaces = [
            { kind: 'npm', manifest: 0 },
            { kind: 'npm', manifest: 1 },
          ]),
      ),
    ).toThrow('workspaces[1] repeats a kind of declaration')
    expect(
      decodeChanged(
        (json) =>
          (json.workspaces = [
            { kind: 'pnpm', manifest: 0 },
            { kind: 'goWork', manifest: 999 },
          ]),
      ),
    ).toThrow('workspaces.manifest[1] points to row 999')
    expect(decodeChanged((json) => (json.packages.framework = [null, 'rails']))).toThrow(
      'packages.framework[1] is not a framework or null',
    )
  })

  it('requires packages in folder order, nested and implicit ones allowed', () => {
    // A repository that declares nothing has implicit packages
    expect(decodeChanged((json) => (json.workspaces = []))().packages.dir).toEqual(
      withPackages().packages.dir,
    )
    expect(decodeChanged((json) => (json.packages.dir = [7, 6]))).toThrow(
      'packages[1] must come after the previous package, by folder',
    )
    // A package inside another (the root holding the others) is valid
    const nested = withPackages()
    nested.packages.dir = [0, 6]
    expect(decodeResult(nested).packages.dir).toEqual([0, 6])
  })

  it('requires names, routes that add up and indexes in bounds', () => {
    expect(decodeChanged((json) => (json.packages.name = ['', 'b']))).toThrow(
      'packages.name[0] is empty',
    )
    expect(decodeChanged((json) => (json.packages.apiRouteCount = [0, 4]))).toThrow(
      'packages[1] must count no more API routes',
    )
    expect(decodeChanged((json) => (json.packages.entry = [null, 99]))).toThrow(
      'packages.entry[1] points to row 99',
    )
    expect(decodeChanged((json) => (json.packages.kind = ['library']))).toThrow(
      'column packages.kind has 1 rows, expected 2',
    )
  })

  it('requires groups of two packages or more, sorted by prefix', () => {
    expect(decodeChanged((json) => (json.packages.group = [0, null]))).toThrow(
      'packageGroups[0] must have a prefix, after the previous one, and two packages or more',
    )
    expect(decodeChanged((json) => (json.packages.group = [1, 1]))).toThrow(
      'packages.group[0] points to row 1',
    )
  })

  it('requires externals named, counted and sorted by package, manifest then name', () => {
    expect(decodeChanged((json) => (json.externals.name = ['react', 'axios']))).toThrow(
      'externals[1] must have a name and files',
    )
    expect(decodeChanged((json) => (json.externals.files = [0, 2]))).toThrow(
      'externals[0] must have a name',
    )
    expect(decodeChanged((json) => (json.externals.package = [null, 2]))).toThrow(
      'externals.package[1] points to row 2',
    )
    // By manifest before name: `axios` declared by a later manifest comes after `react`
    expect(decodeChanged((json) => (json.externals.manifest = [1, 0]))).toThrow(
      'externals[1] must have a name and files, after the previous row by package, manifest then name',
    )
    expect(
      decodeResult({ ...sample, externals: { ...sample.externals, manifest: [0, 1] } }),
    ).toBeTruthy()
    expect(decodeChanged((json) => (json.externals.manifest = [0, 99]))).toThrow(
      'externals.manifest[1] points to row 99',
    )
    expect(decodeChanged((json) => (json.externals.dev = [false, 'yes']))).toThrow('externals.dev')
  })
})
