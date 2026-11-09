import { type PerspectiveCamera, Vector3 } from 'three'
import type { GuideLabel } from '../interaction/city-items'
import { PIN_FOOT, PIN_HEAD_RADIUS, pinStemLength } from '../interaction/pin'
import type { Vec3 } from '../world/units'

// Where the guide's labels stand on the page: just over the head of their roof's pin, at most
// six, those whose pin is out of view left out.

/** No more labels than this at once: the first ones win. */
const MAX_LABELS = 6

export class GuideLabels {
  private last: readonly GuideLabel[] = []
  private readonly projected = new Vector3()

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: PerspectiveCamera,
  ) {}

  /** The labels over these roofs, or null when they stand where they last stood. */
  place(roofs: readonly { path: string; roof: Vec3 }[]): readonly GuideLabel[] | null {
    const { canvas } = this
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    const box = roofs.length > 0 ? canvas.getBoundingClientRect() : null
    const labels: GuideLabel[] = []
    for (const { path, roof } of roofs) {
      if (labels.length === MAX_LABELS || !box) {
        break
      }
      const head = this.headOnCanvas(roof)
      if (!head || head.x < 0 || head.x > width || head.y < 0 || head.y > height) {
        continue
      }
      const y = head.y - PIN_HEAD_RADIUS
      labels.push({ path, x: Math.round(box.left + head.x), y: Math.round(box.top + y) })
    }
    if (sameLabels(labels, this.last)) {
      return null
    }
    this.last = labels
    return labels
  }

  /** The middle of the pin's head over this roof, on the canvas; null behind the camera. */
  private headOnCanvas(roof: Vec3): { x: number; y: number } | null {
    const { camera, canvas } = this
    const foot: Vec3 = [roof[0], roof[1] + PIN_FOOT, roof[2]]
    // A unit's span on screen at the pin's foot, as the stem's shader measures it.
    const depth = -this.projected.set(...foot).applyMatrix4(camera.matrixWorldInverse).z
    if (depth <= 0) {
      return null
    }
    const pixelsPerUnit = (canvas.clientHeight * camera.projectionMatrix.elements[5]) / 2 / depth
    return this.onCanvas([foot[0], foot[1] + pinStemLength(pixelsPerUnit), foot[2]])
  }

  private onCanvas(point: Vec3): { x: number; y: number } | null {
    const projected = this.projected.set(...point).project(this.camera)
    if (projected.z > 1) {
      return null
    }
    return {
      x: ((projected.x + 1) / 2) * this.canvas.clientWidth,
      y: ((1 - projected.y) / 2) * this.canvas.clientHeight,
    }
  }
}

function sameLabels(a: readonly GuideLabel[], b: readonly GuideLabel[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (label, at) => label.path === b[at]?.path && label.x === b[at]?.x && label.y === b[at]?.y,
    )
  )
}
