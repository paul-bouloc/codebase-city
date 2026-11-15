import { describe, expect, it } from 'vitest'
import type { ResultIndex } from '../../result-index'
import type { TourContext } from '../tour/tour-spans'
import { COUNTED_PATHS, routeOf } from './route'

/** A city of files whose imports, islands and layers are written by hand. */
function city(
  imports: number[][],
  island: (number | null)[] = imports.map(() => null),
  layers: (number | null)[] = [],
): TourContext {
  const importers: number[][] = imports.map(() => [])
  imports.forEach((targets, file) => {
    for (const target of targets) {
      importers[target]?.push(file)
    }
  })
  const index = {
    imports,
    importers,
    filePaths: imports.map((_, file) => `f${file}.ts`),
    islandOfFile: (file: number) => island[file] ?? null,
    result: { islands: { layer: layers } },
  } as unknown as ResultIndex
  return { index, islandNames: layers.map((_, at) => `island${at}`), islandFiles: [] }
}

describe('routeOf', () => {
  it('goes along the imports, the fewest steps first', () => {
    // 0 → 1 → 2 → 3, and 0 → 4 → 3: the way through 4 is shorter.
    const route = routeOf(city([[1, 4], [2], [3], [], [3]]), 0, 3)
    expect(route).toMatchObject({ kind: 'found', files: [0, 4, 3], paths: 1, choice: 0 })
  })

  it('takes a direct import as one step', () => {
    expect(routeOf(city([[1], []]), 0, 1)).toMatchObject({ files: [0, 1], paths: 1 })
  })

  it('counts the shortest paths of the same length and goes round them', () => {
    // 0 → 1 → 3 and 0 → 2 → 3.
    const diamond = city([[1, 2], [3], [3], []])
    expect(routeOf(diamond, 0, 3, 0)).toMatchObject({ files: [0, 1, 3], paths: 2, choice: 0 })
    expect(routeOf(diamond, 0, 3, 1)).toMatchObject({ files: [0, 2, 3], choice: 1 })
    expect(routeOf(diamond, 0, 3, 2)).toMatchObject({ files: [0, 1, 3], choice: 0 })
    expect(routeOf(diamond, 0, 3, -1)).toMatchObject({ files: [0, 2, 3], choice: 1 })
  })

  it('gives every shortest path once, each a real one', () => {
    // Two diamonds in a row: 2 × 2 paths.
    const twice = city([[1, 2], [3], [3], [4, 5], [6], [6], []])
    const seen = new Set<string>()
    for (let choice = 0; choice < 4; choice++) {
      const route = routeOf(twice, 0, 6, choice)
      if (route.kind !== 'found') {
        throw new Error('no path')
      }
      expect(route.paths).toBe(4)
      route.files.slice(1).forEach((file, at) => {
        expect(twice.index.imports[route.files[at] ?? -1]).toContain(file)
      })
      seen.add(route.files.join())
    }
    expect(seen.size).toBe(4)
  })

  it('stops counting past the paths it goes through', () => {
    // 0 imports 150 files, each of which imports 151.
    const middle = Array.from({ length: 150 }, (_, at) => at + 1)
    const wide = city([middle, ...middle.map(() => [151]), []])
    const route = routeOf(wide, 0, 151, COUNTED_PATHS)
    expect(route).toMatchObject({ paths: COUNTED_PATHS + 1, choice: 0 })
  })

  it('goes round a cycle without looping', () => {
    const loop = city([[1], [2], [0, 3], []])
    expect(routeOf(loop, 1, 3)).toMatchObject({ files: [1, 2, 3] })
  })

  it('reaches every file of a Go package an import leads to', () => {
    // A Go file's import of a package counts each of its files: 0 → 1, 2 (one package).
    expect(routeOf(city([[1, 2], [], []]), 0, 2)).toMatchObject({ files: [0, 2] })
  })

  describe('without a path', () => {
    it('says the file imports nothing', () => {
      const route = routeOf(city([[], [0]]), 0, 1)
      expect(route).toMatchObject({ kind: 'none', reason: { kind: 'imports-nothing' }, back: 1 })
    })

    it('says nothing imports the other file', () => {
      const route = routeOf(city([[1], [], []]), 0, 2)
      expect(route).toMatchObject({ reason: { kind: 'imported-by-nothing' }, back: null })
    })

    it('says the file stands on a lower layer', () => {
      // 0 (layer 1) → 1; 2 (layer 3) → 3 and 2 → 0.
      const layered = city([[1], [], [3, 0], []], [0, 0, 1, 1], [1, 3])
      expect(routeOf(layered, 0, 3)).toMatchObject({
        reason: {
          kind: 'below',
          from: { island: 'island0', layer: 1 },
          to: { island: 'island1', layer: 3 },
        },
        back: null,
      })
    })

    it('counts the files it reaches otherwise', () => {
      // 0 → 1 → 2, and 3 → 4: same layer, or none.
      const apart = city([[1], [2], [], [4], []], [0, 0, 0, 0, 0], [2])
      expect(routeOf(apart, 0, 4)).toMatchObject({ reason: { kind: 'reaches', files: 2 } })
      expect(routeOf(city([[1], [2], [], [4], []]), 0, 4)).toMatchObject({
        reason: { kind: 'reaches', files: 2 },
      })
    })
  })
})
