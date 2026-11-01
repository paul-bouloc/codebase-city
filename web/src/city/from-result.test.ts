import { describe, expect, it } from 'vitest'
import { decodeResult } from '../data/decode-result'
import type { AnalysisResult } from '../data/generated/AnalysisResult'
import sample from '../data/generated/sample-result.json'
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

  it('puts every file on its lot, with its metrics', () => {
    const lots = city.islands.flatMap((island) => island.lots)
    expect(lots).toHaveLength(result.files.dir.length)
    const main = city.islands[1]?.lots[0]
    expect(main).toMatchObject({ x: 20.9, y: 1.9, base: 0 })
    expect(main?.file).toEqual({
      language: 'typescript',
      lines: 60,
      complexity: 8,
      test: false,
      analyzed: true,
      generated: false,
    })
    // `schema.ts` is generated
    expect(city.islands[5]?.lots[0]?.file.generated).toBe(true)
    // `release.sh`: Shell is not analyzed
    expect(city.islands[7]?.lots[0]?.file.analyzed).toBe(false)
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
    json.layout.lots.x[8] = 465
    json.layout.lots.y[8] = 22
    const core = cityFromResult(decodeResult(json)).islands[2]
    expect(core?.parcels).toEqual([
      { rect: { x: 45.2, y: 0.9, width: 2.6, height: 2.6 }, level: 1, nature: 'tests' },
    ])
    expect(core?.lots.find((lot) => lot.x === 46.5)?.base).toBe(0.15)
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
  })
})
