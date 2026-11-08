import { describe, expect, it } from 'vitest'
import { placeBuildings } from './buildings/placed-buildings'
import { CityPicker, type Ray } from './picking'
import { islandShapes } from './terrain/island-shape'
import type { CityLayout, FileMetrics } from './world/layout'
import { boardToThree, layerAltitude } from './world/units'

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
const shapes = islandShapes(LAYOUT)
const picker = new CityPicker(shapes, placed)

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

  it('takes a building the ray passes near, given some slack', () => {
    // 0.3 u beside the low building's box, from 100 u up: about 0.003 u per u along the ray.
    const low = placed[0]
    if (!low) {
      throw new Error('no building')
    }
    const box = boxEdge(low.position[0], low.building.side)
    const beside = down(box + 0.3, 3)
    expect(picker.pick(beside)).toEqual({ kind: 'island', island: 0 })
    expect(picker.pick(beside, 0.005)).toEqual({ kind: 'building', index: 0 })
    expect(picker.pick(beside, 0.001)).toEqual({ kind: 'island', island: 0 })
  })

  it('takes the building nearest the ray among those close enough', () => {
    // Halfway between the two buildings, a little nearer the tall one.
    expect(picker.pick(down(5.3, 3), 0.05)).toEqual({ kind: 'building', index: 1 })
    expect(picker.pick(down(4.7, 3), 0.05)).toEqual({ kind: 'building', index: 0 })
  })

  it('takes a terrace or the beach for its island', () => {
    const shape = shapes[0]
    const sample = shape?.samples.find(({ nx, ny }) => nx === 0 && ny === -1)
    const beach = sample?.offsets.at(-1)
    if (!sample || beach === undefined) {
      throw new Error('no beach')
    }
    // Past the plateau's south edge, on the beach, then out at sea.
    expect(picker.pick(down(sample.x, -(beach - 0.2)))).toEqual({ kind: 'island', island: 0 })
    expect(picker.pick(down(sample.x, -(beach + 0.5)))).toBeNull()
  })
})

describe('CityPicker.groundHeight', () => {
  /** The height at a board point. */
  const height = (x: number, y: number) => {
    const [tx, , tz] = boardToThree(x, y, 0)
    return picker.groundHeight(tx, tz)
  }

  it('is the plateau on the island, buildings aside', () => {
    expect(height(5, 1)).toBe(layerAltitude(2))
    expect(height(3, 3)).toBe(layerAltitude(2))
  })

  it('steps down the terraces to the beach, then the sea', () => {
    const shape = shapes[0]
    const sample = shape?.samples.find(({ nx, ny }) => nx === 0 && ny === -1)
    if (!shape || !sample) {
      throw new Error('no south side')
    }
    const heights = sample.offsets.map((offset) => height(sample.x, -(offset - 0.05)))
    expect(heights).toEqual(shape.altitudes)
    expect(height(sample.x, -((sample.offsets.at(-1) ?? 0) + 0.5))).toBe(0)
    expect(height(50, 50)).toBe(0)
  })
})

/** The east edge of a building's box, standing at `x` (three.js x is board x). */
function boxEdge(x: number, side: number): number {
  const placedBox = picker.pick(down(x, 3))
  if (placedBox?.kind !== 'building') {
    throw new Error('no building there')
  }
  let edge = x
  while (picker.pick(down(edge + 0.01, 3))?.kind === 'building' && edge < x + side) {
    edge += 0.01
  }
  return edge
}
