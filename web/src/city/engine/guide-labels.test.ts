import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { PIN_FOOT, PIN_HEAD_RADIUS } from '../interaction/pin'
import type { Vec3 } from '../world/units'
import { GuideLabels } from './guide-labels'

const WIDTH = 1000
const HEIGHT = 500
/** Where the canvas stands on the page. */
const BOX = { left: 10, top: 20 }

function setup(distance: number) {
  const canvas = {
    clientWidth: WIDTH,
    clientHeight: HEIGHT,
    getBoundingClientRect: () => BOX,
  } as unknown as HTMLCanvasElement
  const camera = new PerspectiveCamera(50, WIDTH / HEIGHT, 0.1, 5000)
  camera.position.set(0, distance * 0.6, distance * 0.8)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  const onPage = (point: Vec3) => {
    const projected = new Vector3(...point).project(camera)
    return {
      x: BOX.left + ((projected.x + 1) / 2) * WIDTH,
      y: BOX.top + ((1 - projected.y) / 2) * HEIGHT,
    }
  }
  /** A unit's span on screen at this point, as the pin's shader measures it. */
  const pixelsPerUnit = (point: Vec3) => {
    const depth = -new Vector3(...point).applyMatrix4(camera.matrixWorldInverse).z
    return (HEIGHT * camera.projectionMatrix.elements[5]) / 2 / depth
  }
  return { labels: new GuideLabels(canvas, camera), onPage, pixelsPerUnit }
}

describe('GuideLabels', () => {
  it('stands a label just over the head of a near pin, the stem as long as in the scene', () => {
    const { labels, onPage } = setup(20)
    const [label] = labels.place([{ path: 'a.ts', roof: [0, 1, 0] }]) ?? []
    // Near, the stem keeps its 2.2 u: the head's middle is 2.6 u over the roof.
    const head = onPage([0, 1 + PIN_FOOT + 2.2, 0])
    expect(label?.path).toBe('a.ts')
    expect(label?.x).toBeCloseTo(head.x, 0)
    expect(label?.y).toBeCloseTo(head.y - PIN_HEAD_RADIUS, 0)
  })

  it('keeps a far pin at its least length on screen', () => {
    const { labels, onPage, pixelsPerUnit } = setup(2000)
    const [label] = labels.place([{ path: 'a.ts', roof: [0, 1, 0] }]) ?? []
    // The stem rises 28 px as seen face on: a little less from above.
    const stem = 28 / pixelsPerUnit([0, 1 + PIN_FOOT, 0])
    expect(stem).toBeGreaterThan(2.2)
    const head = onPage([0, 1 + PIN_FOOT + stem, 0])
    expect(label?.y).toBeCloseTo(head.y - PIN_HEAD_RADIUS, 0)
  })

  it('tells only of a change, and leaves out pins out of view, six at most', () => {
    const { labels } = setup(40)
    const roofs = Array.from({ length: 8 }, (_, at) => ({
      path: `f${at}.ts`,
      roof: [at - 4, 0, 0] as Vec3,
    }))
    expect(labels.place(roofs)?.map(({ path }) => path)).toEqual([
      'f0.ts',
      'f1.ts',
      'f2.ts',
      'f3.ts',
      'f4.ts',
      'f5.ts',
    ])
    expect(labels.place(roofs)).toBeNull()
    // Far off to the side, and behind the camera.
    expect(
      labels.place([
        { path: 'side.ts', roof: [500, 0, 0] },
        { path: 'behind.ts', roof: [0, 0, 200] },
      ]),
    ).toEqual([])
    expect(labels.place([])).toBeNull()
  })
})
