import { type PerspectiveCamera, Vector3 } from 'three'
import type { GuideLabel } from '../interaction/city-items'
import { PIN_TOP, PIN_TOP_MINIMUM } from '../interaction/pin'
import type { Vec3 } from '../world/units'

// Where the guide's labels stand on the page: over the head of their roof's pin, at most six,
// those out of view left out.

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
      const foot = this.onCanvas(roof)
      if (!foot) {
        continue
      }
      // Over the pin's head: its stem has a least length on screen.
      const head = this.onCanvas([roof[0], roof[1] + PIN_TOP, roof[2]])
      const y = Math.min(head?.y ?? foot.y, foot.y - PIN_TOP_MINIMUM)
      if (foot.x < 0 || foot.x > width || y < 0 || y > height) {
        continue
      }
      labels.push({ path, x: Math.round(box.left + foot.x), y: Math.round(box.top + y) })
    }
    if (sameLabels(labels, this.last)) {
      return null
    }
    this.last = labels
    return labels
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
