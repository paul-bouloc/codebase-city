import { PerspectiveCamera } from 'three'
import { describe, expect, it } from 'vitest'
import type { AreaLabelText } from '../interaction/city-items'
import type { CityLayout } from '../world/layout'
import { AreaLabels } from './area-labels'
import { LABEL_SETTLE_MS } from './label-placement'

const WIDTH = 1000
const HEIGHT = 600
/** Where the canvas stands on the page. */
const BOX = { left: 10, top: 20 }

/** Two islands side by side, the first with a folder. */
const LAYOUT: CityLayout = {
  islands: [
    {
      path: 'core',
      layer: 1,
      plateau: { x: -40, y: -10, width: 30, height: 20 },
      parcels: [
        {
          rect: { x: -38, y: -8, width: 20, height: 16 },
          path: 'core/src',
          level: 1,
          nature: 'normal',
        },
      ],
      lots: [],
    },
    {
      path: 'web',
      layer: 2,
      plateau: { x: 10, y: -10, width: 30, height: 20 },
      parcels: [],
      lots: [],
    },
  ],
  bounds: { x: -40, y: -10, width: 80, height: 20 },
}

const TEXTS = new Map<string, AreaLabelText>([
  ['core', { name: 'core', caption: '≈ 1,200 files · layer 1' }],
  ['web', { name: 'web', caption: '840 files · layer 2' }],
  ['core/src', { name: 'src', caption: null }],
])

/** Ten pixels a character, whatever the font. */
const measure = (text: string) => text.length * 10

function setup(distance: number, texts: ReadonlyMap<string, AreaLabelText> = TEXTS) {
  const canvas = {
    clientWidth: WIDTH,
    clientHeight: HEIGHT,
    getBoundingClientRect: () => BOX,
  } as unknown as HTMLCanvasElement
  const camera = new PerspectiveCamera(50, WIDTH / HEIGHT, 0.1, 5000)
  // Looking down at the city from the south: board x runs left to right on screen.
  camera.position.set(0, distance, distance * 0.3)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  const labels = new AreaLabels(canvas, camera, measure)
  labels.setLayout(LAYOUT)
  labels.setTexts(texts)
  return labels
}

/** Moves the camera of `labels` to look at the city from this far. */
function moveTo(labels: AreaLabels, distance: number) {
  const camera = (labels as unknown as { camera: PerspectiveCamera }).camera
  camera.position.set(0, distance, distance * 0.3)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
}

/** The labels once they have settled: those with room come after `LABEL_SETTLE_MS`. */
function settle(labels: AreaLabels, selected: Parameters<AreaLabels['place']>[0] = null) {
  labels.place(selected, 0)
  return labels.place(selected, LABEL_SETTLE_MS)
}

const paths = (shown: readonly { path: string }[] | null) =>
  (shown ?? []).map((label) => label.path).sort()

describe('AreaLabels', () => {
  it('labels both islands and the folder up close, each island’s label out to the sea', () => {
    const shown = settle(setup(60)) ?? []
    expect(paths(shown)).toEqual(['core', 'core/src', 'web'])
    const core = shown.find((label) => label.path === 'core')
    const web = shown.find((label) => label.path === 'web')
    // `core` is west of the city: its label runs left of its anchor; `web`, on the east edge,
    // runs right of its own.
    expect(core?.lean).toBe('end')
    expect(web?.lean).toBe('start')
    expect(shown.find((label) => label.path === 'core/src')?.lean).toBe('centre')
    // Anchors on the page, past the canvas's corner.
    expect(core?.x).toBeGreaterThan(BOX.left)
    expect(core?.y).toBeGreaterThan(BOX.top)
  })

  it('drops the folder, then the line of figures, then the islands, as the camera pulls back', () => {
    const near = settle(setup(60)) ?? []
    expect(near.find((label) => label.path === 'core')?.caption).toBe('≈ 1,200 files · layer 1')
    const middle = settle(setup(250))
    expect(paths(middle)).toEqual(['core', 'web'])
    expect((middle ?? []).every((label) => label.caption === null)).toBe(true)
    // Nothing to show from the start: nothing new to say.
    expect(settle(setup(2000))).toBeNull()
  })

  it('brings a label once it has had room for a while, and the selected one at once', () => {
    const labels = setup(60)
    expect(labels.place(null, 0)).toBeNull()
    expect(labels.pending).toBe(true)
    expect(labels.place(null, LABEL_SETTLE_MS - 1)).toBeNull()
    expect(paths(labels.place(null, LABEL_SETTLE_MS))).toEqual(['core', 'core/src', 'web'])
    expect(labels.pending).toBe(false)
    const far = setup(2000)
    const selected = far.place({ kind: 'parcel', island: 0, parcel: 0 }, 0)
    expect(paths(selected)).toEqual(['core/src'])
  })

  it('gives no label to a folder the screen has no text for', () => {
    const shown = settle(setup(60, new Map([['web', { name: 'web', caption: null }]])))
    expect(paths(shown)).toEqual(['web'])
  })

  it('says nothing new while the labels stand still', () => {
    const labels = setup(60)
    expect(settle(labels)).not.toBeNull()
    expect(labels.place(null, 1000)).toBeNull()
  })

  it('finds the island or folder whose label is under a point of the canvas', () => {
    const labels = setup(60)
    const folder = (settle(labels) ?? []).find((label) => label.path === 'core/src')
    if (!folder) {
      throw new Error('no label for core/src')
    }
    expect(labels.at(folder.x - BOX.left, folder.y - BOX.top)).toEqual({
      kind: 'parcel',
      island: 0,
      parcel: 0,
    })
    expect(labels.at(0, 0)).toBeNull()
  })

  it('keeps a label on show a little under the threshold it passed', () => {
    // From 330 u away, the islands span under 60 px, but more than 60 / 1.15.
    expect(settle(setup(330))).toBeNull()
    const labels = setup(250)
    expect(paths(settle(labels))).toEqual(['core', 'web'])
    moveTo(labels, 330)
    // Still on show: they moved on screen, so they are told again.
    expect(paths(labels.place(null, 1000))).toEqual(['core', 'web'])
  })

  it('stands labels to the fraction of a pixel while the camera moves, on whole pixels at rest', () => {
    const labels = setup(61)
    labels.place(null, 0, true)
    const moving = labels.place(null, LABEL_SETTLE_MS, true) ?? []
    expect(moving.some((label) => !Number.isInteger(label.x))).toBe(true)
    const still = labels.place(null, LABEL_SETTLE_MS, false) ?? []
    expect(still.every((label) => Number.isInteger(label.x) && Number.isInteger(label.y))).toBe(
      true,
    )
  })
})
