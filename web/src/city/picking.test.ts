import { describe, expect, it } from 'vitest'
import type { CityLayout, FileMetrics } from './layout'
import { CityPicker, type Ray } from './picking'
import { placeBuildings } from './placed-buildings'
import { boardToThree, layerAltitude } from './units'

const file = (path: string, complexity: number): FileMetrics => ({
  path,
  language: 'typescript',
  lines: 300,
  complexity,
  test: false,
})

// One island: a low building at (3, 3), a tall one at (7, 3), and a folder in its north half.
const LAYOUT: CityLayout = {
  islands: [
    {
      path: 'src',
      layer: 2,
      plateau: { x: 0, y: 0, width: 10, height: 10 },
      parcels: [
        { rect: { x: 0, y: 5, width: 10, height: 5 }, path: 'src/ui', level: 1, nature: 'normal' },
        // A slab under a folder's own files has no path: the folder around it is what is hit.
        { rect: { x: 1, y: 6, width: 3, height: 3 }, level: 2, nature: 'normal' },
      ],
      lots: [
        { x: 3, y: 3, file: file('src/low.ts', 1) },
        { x: 7, y: 3, file: file('src/tall.ts', 400) },
      ],
    },
  ],
  bounds: { x: 0, y: 0, width: 10, height: 10 },
}

const placed = placeBuildings(LAYOUT)
const picker = new CityPicker(LAYOUT, placed)

/** Straight down onto a board point. */
const down = (x: number, y: number): Ray => ({
  origin: boardToThree(x, y, 100),
  direction: [0, -1, 0],
})

describe('CityPicker', () => {
  it('finds the building under a ray', () => {
    expect(picker.pick(down(3, 3))).toEqual({ kind: 'building', index: 0 })
    expect(picker.pick(down(7, 3))).toEqual({ kind: 'building', index: 1 })
  })

  it('finds the plateau between buildings, and the deepest folder with a path', () => {
    expect(picker.pick(down(5, 1))).toEqual({ kind: 'island', island: 0 })
    expect(picker.pick(down(2, 7))).toEqual({ kind: 'parcel', island: 0, parcel: 0 })
  })

  it('finds nothing over the sea', () => {
    expect(picker.pick(down(20, 20))).toBeNull()
    expect(picker.pick({ origin: [5, 50, -5], direction: [0, 1, 0] })).toBeNull()
  })

  it('takes the nearest building along the ray', () => {
    // Just above the ground, along the row of both buildings: the first one met wins.
    const y = layerAltitude(2) + 0.1
    expect(picker.pick({ origin: [50, y, -3], direction: [-1, 0, 0] })).toEqual({
      kind: 'building',
      index: 1,
    })
    expect(picker.pick({ origin: [-50, y, -3], direction: [1, 0, 0] })).toEqual({
      kind: 'building',
      index: 0,
    })
  })

  it('reaches as high as the building goes, roof included', () => {
    const tall = placed[1]
    if (!tall) {
      throw new Error('no building')
    }
    const roof = layerAltitude(2) + tall.building.height
    const level = (height: number): Ray => ({
      origin: [7, height, 50],
      direction: [0, 0, -1],
    })
    expect(picker.pick(level(roof - 0.05))).toEqual({ kind: 'building', index: 1 })
    expect(picker.pick(level(roof + 5))).toBeNull()
  })
})
