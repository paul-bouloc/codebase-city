import { PerspectiveCamera } from 'three'
import { describe, expect, it } from 'vitest'
import type { CityGuideUnit } from '../interaction/city-guide'
import type { CityLayout } from '../world/layout'
import { UnitLabels } from './unit-labels'

const WIDTH = 1000
const HEIGHT = 600

/** Three islands in a row, the first with a folder. */
const LAYOUT: CityLayout = {
  islands: [-60, -10, 40].map((x, at) => ({
    path: `app-${at}`,
    layer: 1,
    plateau: { x, y: -10, width: 20, height: 20 },
    parcels:
      at === 0
        ? [
            {
              rect: { x: x + 2, y: -8, width: 10, height: 10 },
              path: 'app-0/ui',
              level: 1,
              nature: 'normal',
            },
          ]
        : [],
    lots: [],
  })),
  bounds: { x: -60, y: -10, width: 120, height: 20 },
}

/** Ten pixels a character, whatever the font. */
const measure = (text: string) => text.length * 10

function setup() {
  const canvas = { clientWidth: WIDTH, clientHeight: HEIGHT } as unknown as HTMLCanvasElement
  const camera = new PerspectiveCamera(50, WIDTH / HEIGHT, 0.1, 5000)
  camera.position.set(0, 150, 45)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  const labels = new UnitLabels(canvas, camera, measure)
  labels.setLayout(LAYOUT)
  return { labels, camera }
}

const label = (name: string, caption: string | null = null) => ({ name, caption })

describe('UnitLabels', () => {
  it('pins each unit straight over its largest island, a group with a leader to each', () => {
    const { labels } = setup()
    const units: CityGuideUnit[] = [
      { islands: [1, 2], parcel: null, label: label('billing', '2 apps · 40 files') },
      { islands: [0], parcel: null, label: label('web') },
    ]
    labels.setUnits(units)
    const placed = labels.place(false)
    expect(placed.map((each) => [each.name, each.guide, each.leads?.length])).toEqual([
      ['billing', 'full', 2],
      ['web', 'short', 1],
    ])
    for (const each of placed) {
      // Straight over its anchor, the middle of its island
      expect(each.box.y + each.box.height).toBeLessThanOrEqual(each.y)
      expect(each.box.x + each.box.width / 2).toBeCloseTo(each.x)
    }
    expect(labels.active).toBe(true)
  })

  it('labels a package inside another by its parcel, and keeps its host island named', () => {
    const { labels } = setup()
    labels.setUnits([
      { islands: [], parcel: { island: 0, parcel: 0 }, label: label('ui', 'library inside web') },
    ])
    const [placed] = labels.place(false)
    expect(placed?.guide).toBe('parcel')
    expect(labels.hosts(0)).toBe(true)
    expect(labels.hosts(1)).toBe(false)
  })

  it('keeps each label beside its anchor while the camera moves, and places it again at rest', () => {
    const { labels, camera } = setup()
    labels.setUnits([{ islands: [1], parcel: null, label: label('api') }])
    const [before] = labels.place(false)
    camera.position.set(30, 150, 45)
    camera.updateMatrixWorld()
    const [moving] = labels.place(true)
    expect(moving && before && moving.box.x - moving.x).toBeCloseTo(
      before ? before.box.x - before.x : 0,
    )
    expect(moving?.x).not.toBeCloseTo(before?.x ?? 0)
    expect(labels.place(false)).toHaveLength(1)
  })

  it('finds the island under a label, and gives no label to a unit without one', () => {
    const { labels } = setup()
    labels.setUnits([
      { islands: [2], parcel: null, label: label('api') },
      { islands: [0], parcel: null, label: null },
    ])
    const [placed] = labels.place(false)
    expect(placed && labels.at(placed.box.x + 1, placed.box.y + 1)).toEqual({
      kind: 'island',
      island: 2,
    })
    expect(labels.at(0, 0)).toBeNull()
    labels.setUnits([])
    expect(labels.place(false)).toEqual([])
    expect(labels.active).toBe(false)
  })
})
