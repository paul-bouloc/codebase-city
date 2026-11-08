import { describe, expect, it } from 'vitest'
import { decodeResult } from '../../data/decode-result'
import type { AnalysisResult } from '../../data/generated/AnalysisResult'
import sample from '../../data/generated/sample-result.json'
import { cityFromResult } from './from-result'
import { slabTop } from './units'

describe('cityFromResult', () => {
  const result = decodeResult(sample)
  const city = cityFromResult(result)

  it('makes an island of each island of the result, in units', () => {
    expect(city.islands).toHaveLength(result.islands.dir.length)
    expect(city.islands[0]?.plateau).toEqual({ x: 0, y: 0, width: 10, height: 6.6 })
    expect(city.islands[2]?.layer).toBe(1)
    // Without production code, an island stays at the bottom
    expect(city.islands[0]?.layer).toBe(1)
    expect(city.bounds).toEqual({ x: 0, y: 0, width: 67, height: 22.2 })
  })

  it('keeps the imports between islands, by island', () => {
    expect(city.links).toHaveLength(result.links.from.length)
    expect(city.links?.[3]).toEqual({ from: 3, to: 2, imports: 3, upward: 0 })
  })

  it('keeps the imports between files, by their lots', () => {
    expect(city.imports).toHaveLength(result.edges.from.length)
    // `main.ts` imports `app.ts`, both on the `src` island
    expect(city.imports?.[0]).toEqual({
      from: { island: 1, lot: 0 },
      to: { island: 1, lot: 1 },
      upward: false,
    })
  })

  it('tells an import up the layers, and an import of a folder', () => {
    const json = structuredClone(sample) as unknown as AnalysisResult
    const edges = json.edges
    // `utils.ts` (core, layer 1) imports `button.ts` (ui, layer 2), then re-exports `client.ts`
    // (api, layer 2), then imports the `ui` folder as a package
    edges.from.push(8, 8, 8)
    edges.to.push(10, 14, null)
    edges.toDir.push(null, null, 3)
    edges.kind.push('import', 'reexport', 'import')
    edges.confidence.push('exact', 'exact', 'exact')
    const imports = cityFromResult(json).imports?.slice(-3)
    expect(imports).toEqual([
      { from: { island: 2, lot: 4 }, to: { island: 3, lot: 1 }, upward: true },
      // A barrel offers what it re-exports: it does not depend on it
      { from: { island: 2, lot: 4 }, to: { island: 4, lot: 0 }, upward: false },
      { from: { island: 2, lot: 4 }, to: { island: 3, grid: 0 }, upward: true },
    ])
  })

  it('keeps the cycles by their lots, with the plain imports between members', () => {
    const pathOf = ({ island, lot }: { island: number; lot: number }) =>
      city.islands[island]?.lots[lot]?.file.path
    expect(city.cycles).toHaveLength(2)
    const [store, view] = city.cycles ?? []
    expect(store?.members.map(pathOf)).toEqual(['src/core/store.ts', 'src/core/events.ts'])
    expect(store?.loop).toEqual([0, 1])
    expect(store?.imports).toEqual([
      [0, 1],
      [1, 0],
    ])
    expect(view?.members.map(pathOf)).toEqual(['src/ui/view.ts', 'src/ui/panel.ts'])
  })

  it('puts every file on its lot, with its metrics', () => {
    const lots = city.islands.flatMap((island) => island.lots)
    expect(lots).toHaveLength(result.files.dir.length)
    const main = city.islands[1]?.lots[0]
    expect(main).toMatchObject({ x: 20.9, y: 1.9, base: 0 })
    expect(main?.file).toEqual({
      path: 'src/main.ts',
      language: 'typescript',
      lines: 60,
      complexity: 8,
      test: false,
      analyzed: true,
      generated: false,
    })
    // `schema.ts` is generated
    expect(city.islands[5]?.lots[0]?.file.generated).toBe(true)
    // `release.sh`: Shell is not analyzed, and takes the scripts' concrete
    expect(city.islands[7]?.lots[0]?.file).toMatchObject({ analyzed: false, family: 'scripts' })
    expect(city.islands[0]?.lots[0]?.file.family).toBe('data')
    // Every lot knows its folder's grid, which holds it
    for (const lot of lots) {
      const grid = lot.grid
      expect(grid).toBeDefined()
      if (grid) {
        expect(lot.x).toBeGreaterThan(grid.x)
        expect(lot.x).toBeLessThan(grid.x + grid.width)
        expect(lot.y).toBeGreaterThan(grid.y)
        expect(lot.y).toBeLessThan(grid.y + grid.height)
      }
    }
    // A file at the root has no folder in its path
    expect(city.islands[0]?.lots.map((lot) => lot.file.path)).toContain('package.json')
    const css = lots.find((lot) => lot.file.language === 'css')
    expect(css).toBeDefined()
    const test = city.islands[6]?.lots[0]
    expect(test?.file.test).toBe(true)
  })

  it('turns folders below an island into parcels, and raises their lots', () => {
    // `utils.ts` moved to a new folder, `src/core/sub`, in the `core` island
    const json = structuredClone(sample) as unknown as AnalysisResult
    json.dirs.parent.push(2)
    json.dirs.name.push('sub')
    json.dirs.island.push(2)
    json.files.dir[8] = 8
    json.layout.parcels = {
      dir: [8],
      x: [452],
      y: [9],
      width: [26],
      height: [26],
      nature: ['tests'],
    }
    json.layout.grids.dir.push(8)
    json.layout.grids.x.push(455)
    json.layout.grids.y.push(12)
    json.layout.grids.columns.push(1)
    json.layout.grids.rows.push(1)
    json.layout.grids.nature.push('tests')
    json.layout.lots.x[8] = 465
    json.layout.lots.y[8] = 22
    const core = cityFromResult(decodeResult(json)).islands[2]
    expect(core?.parcels).toEqual([
      {
        rect: { x: 45.2, y: 0.9, width: 2.6, height: 2.6 },
        path: 'src/core/sub',
        level: 1,
        nature: 'tests',
        paved: false,
      },
    ])
    expect(core?.lots.find((lot) => lot.x === 46.5)).toMatchObject({ base: 0.15, ground: 'tests' })
    // On the plateau, the ground is ordinary
    expect(core?.lots[0]?.ground).toBe('normal')
  })

  it('paves a folder with subfolders, and raises its own files on a slab', () => {
    // In the `core` island, `src/core/sub` holds `utils.ts` and a folder, `deep`, with `index.ts`
    const json = structuredClone(sample) as unknown as AnalysisResult
    json.dirs.parent.push(2, 8)
    json.dirs.name.push('sub', 'deep')
    json.dirs.island.push(2, 2)
    json.files.dir[7] = 8
    json.files.dir[8] = 9
    json.layout.islands.width[2] = 150
    json.layout.parcels = {
      dir: [8, 9],
      x: [432, 464],
      y: [6, 9],
      width: [64, 26],
      height: [32, 26],
      nature: ['normal', 'normal'],
    }
    json.layout.grids.columns[2] = 2
    json.layout.grids.dir.push(8, 9)
    json.layout.grids.x.push(435, 467)
    json.layout.grids.y.push(12, 12)
    json.layout.grids.columns.push(1, 1)
    json.layout.grids.rows.push(1, 1)
    // `sub`'s own file is a test, though most of its subtree is not
    json.layout.grids.nature.push('tests', 'normal')
    json.layout.lots.x.splice(6, 3, 399, 445, 477)
    json.layout.lots.y.splice(6, 3, 19, 22, 22)
    const core = cityFromResult(decodeResult(json)).islands[2]
    expect(core?.parcels).toEqual([
      {
        rect: { x: 43.2, y: 0.6, width: 6.4, height: 3.2 },
        path: 'src/core/sub',
        level: 1,
        nature: 'normal',
        paved: true,
      },
      {
        rect: { x: 46.4, y: 0.9, width: 2.6, height: 2.6 },
        path: 'src/core/sub/deep',
        level: 2,
        nature: 'normal',
        paved: false,
      },
      // The slab of `sub`'s own files, of their own nature
      {
        rect: { x: 43.2, y: 0.9, width: 2.6, height: 2.6 },
        level: 2,
        nature: 'tests',
        paved: false,
      },
    ])
    expect(core?.lots.find((lot) => lot.x === 44.5)?.ground).toBe('tests')
    expect(core?.lots.find((lot) => lot.x === 44.5)?.base).toBe(slabTop(2))
    expect(core?.lots.find((lot) => lot.x === 47.7)?.base).toBe(slabTop(2))
    // The island folder's own files stand in a square on the plateau
    expect(core?.square).toEqual({ x: 38.6, y: 0.6, width: 4.6, height: 4.6 })
    // Every grid, its lots alone, at the height of the ground under them
    expect(core?.grids).toEqual([
      { rect: { x: 38.9, y: 0.9, width: 4, height: 4 }, nature: 'normal', base: 0, square: true },
      { rect: { x: 43.5, y: 1.2, width: 2, height: 2 }, nature: 'tests', base: slabTop(2) },
      { rect: { x: 46.7, y: 1.2, width: 2, height: 2 }, nature: 'normal', base: slabTop(2) },
    ])
  })

  it('raises the own files of an island folder on a slab when they are not ordinary code', () => {
    const json = structuredClone(sample) as unknown as AnalysisResult
    json.layout.grids.nature[2] = 'tests'
    const core = cityFromResult(decodeResult(json)).islands[2]
    // The slab is drawn from the square's grid: the square stays apart from the folders
    expect(core?.parcels).toEqual([])
    expect(core?.square).toEqual({ x: 38.6, y: 0.6, width: 6.6, height: 4.6 })
    expect(core?.grids?.[0]).toMatchObject({ nature: 'tests', base: slabTop(1), square: true })
    expect(core?.lots.every((lot) => lot.ground === 'tests' && lot.base === slabTop(1))).toBe(true)
  })

  it('names each island by its full path, so that two of one name differ', () => {
    // `src/core` becomes an island named `src` too, under `src`
    const json = structuredClone(sample) as unknown as AnalysisResult
    const core = json.islands.dir[2] ?? 0
    json.dirs.name[core] = 'src'
    const city = cityFromResult(decodeResult(json))
    const paths = city.islands.map((island) => island.path)
    expect(paths).toContain('src/src')
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('names the languages it paints in their own colour', () => {
    const json = structuredClone(sample) as unknown as AnalysisResult
    json.languages = ['Python', 'Go', 'JSON', 'Shell']
    const lots = cityFromResult(decodeResult(json)).islands.flatMap((island) => island.lots)
    const languages = new Set(lots.map((lot) => lot.file.language))
    expect([...languages].sort()).toEqual(['go', 'other', 'python'])
  })

  it('raises each level of slabs above the one it stands on', () => {
    expect(slabTop(0)).toBe(0)
    expect(slabTop(1)).toBe(0.15)
    expect(slabTop(2)).toBe(0.25)
    expect(slabTop(3)).toBeCloseTo(0.3)
    expect(slabTop(5)).toBeCloseTo(0.4)
    // Folders thousands deep stop rising
    expect(slabTop(24)).toBeCloseTo(1.35)
    expect(slabTop(3000)).toBeCloseTo(1.35)
  })
})
