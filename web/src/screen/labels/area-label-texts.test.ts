import { describe, expect, it } from 'vitest'
import type { CityLayout, IslandLayout } from '../../city/world/layout'
import { areaLabelTexts, filesCount, islandNames } from './area-label-texts'

function island(path: string, files: number, layer: number): IslandLayout {
  return {
    path,
    layer,
    plateau: { x: 0, y: 0, width: 10, height: 10 },
    parcels: [
      {
        rect: { x: 0, y: 0, width: 4, height: 4 },
        path: `${path}/lib/util`,
        level: 2,
        nature: 'normal',
      },
      { rect: { x: 0, y: 0, width: 2, height: 2 }, level: 3, nature: 'normal' },
    ],
    lots: Array.from({ length: files }, () => ({
      x: 0,
      y: 0,
      file: {} as IslandLayout['lots'][number]['file'],
    })),
  }
}

describe('islandNames', () => {
  it('names an island by its last folder', () => {
    expect(islandNames(['packages/core', 'apps/web', 'docs'])).toEqual(['core', 'web', 'docs'])
  })

  it('takes in the folders before until the names differ', () => {
    expect(islandNames(['a/x/src', 'b/x/src', 'c/lib'])).toEqual(['a/x/src', 'b/x/src', 'lib'])
    expect(islandNames(['a/src', 'b/src', 'src'])).toEqual(['a/src', 'b/src', 'src'])
  })

  it('keeps the root island’s path, which has no folder', () => {
    expect(islandNames(['/', 'core'])).toEqual(['/', 'core'])
  })
})

describe('filesCount', () => {
  it('counts exactly below a hundred, to two figures after', () => {
    expect(filesCount(1)).toBe('1 file')
    expect(filesCount(42)).toBe('42 files')
    expect(filesCount(99)).toBe('99 files')
    expect(filesCount(100)).toBe('≈ 100 files')
    expect(filesCount(7878)).toBe('≈ 7,900 files')
    expect(filesCount(15212)).toBe('≈ 15,000 files')
  })
})

describe('areaLabelTexts', () => {
  it('writes each island’s name over its files and layer, and each folder’s name', () => {
    const texts = areaLabelTexts(
      {
        islands: [island('packages/core', 1234, 1), island('apps/web', 12, 2)],
        bounds: { x: 0, y: 0, width: 10, height: 10 },
      } satisfies CityLayout,
      'acme',
    )
    expect(texts.get('packages/core')).toEqual({
      name: 'core',
      caption: '≈ 1,200 files · layer 1',
    })
    expect(texts.get('apps/web')).toEqual({ name: 'web', caption: '12 files · layer 2' })
    expect(texts.get('apps/web/lib/util')).toEqual({ name: 'util', caption: null })
    expect(texts.size).toBe(4)
  })

  it('leaves out the layer of a city on a single one', () => {
    const texts = areaLabelTexts(
      {
        islands: [island('core', 3, 1), island('web', 4, 1), island('/', 5, 1)],
        bounds: { x: 0, y: 0, width: 10, height: 10 },
      },
      'acme',
    )
    expect(texts.get('core')?.caption).toBe('3 files')
    // The root island bears the repository's name.
    expect(texts.get('/')?.name).toBe('acme')
  })
})
