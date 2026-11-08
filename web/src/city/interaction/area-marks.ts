import { Group, type Mesh, type ShaderMaterial } from 'three'
import { createScreenLines } from '../render/screen-lines'
import type { IslandShape } from '../terrain/island-shape'
import { roundedOutline } from '../terrain/plateaux'
import type { Rect } from '../world/layout'
import { boardToThree, layerAltitude, slabTop, type Vec3 } from '../world/units'
import { INK } from './building-marks'

// The outline of a folder: along the edge of its island's plateau, or around its parcel.

/** How a folder is outlined: its width and dashes in CSS pixels, its distance from the parcel. */
export interface AreaStyle {
  width: number
  dash?: [number, number]
  /** Past the parcel's edge, in u. */
  gap: number
}

export const HOVERED_AREA: AreaStyle = { width: 1.6, dash: [5, 4], gap: 0.25 }
export const SELECTED_AREA: AreaStyle = { width: 2.6, gap: 0.35 }

/** Above the plateau, clear of the slabs of the first two levels. */
const PARCEL_LIFT = 0.3
/** Above the plateau's edge. */
const EDGE_LIFT = 0.05
/** The parcels' rounded corners, in u. */
const CORNER_RADIUS = 0.7

/** What a folder outline goes around. */
export type Area = { island: number } | { island: number; rect: Rect; level: number }

export class AreaMark {
  readonly group = new Group()

  constructor(
    private readonly style: AreaStyle,
    private readonly pixelRatio: number,
  ) {}

  /** Outlines this folder, or none. */
  show(area: Area | null, shapes: readonly IslandShape[]): void {
    this.clear()
    const shape = area ? shapes[area.island] : undefined
    if (!area || !shape) {
      return
    }
    const altitude = layerAltitude(shape.island.layer)
    const points =
      'rect' in area
        ? parcelOutline(
            area.rect,
            this.style.gap,
            altitude + Math.max(PARCEL_LIFT, slabTop(area.level)),
          )
        : shape.samples.map(({ x, y, nx, ny, offsets }) => {
            const out = offsets[0] ?? 0
            return boardToThree(x + nx * out, y + ny * out, altitude + EDGE_LIFT)
          })
    this.group.add(
      createScreenLines(
        [points],
        { width: this.style.width, colour: INK, dash: this.style.dash },
        this.pixelRatio,
      ),
    )
  }

  dispose(): void {
    this.clear()
  }

  private clear(): void {
    for (const child of [...this.group.children] as Mesh[]) {
      this.group.remove(child)
      child.geometry.dispose()
      ;(child.material as ShaderMaterial).dispose()
    }
  }
}

function parcelOutline(rect: Rect, gap: number, z: number): Vec3[] {
  const grown = {
    x: rect.x - gap,
    y: rect.y - gap,
    width: rect.width + 2 * gap,
    height: rect.height + 2 * gap,
  }
  return roundedOutline(grown, CORNER_RADIUS + gap).map(([x, y]) => boardToThree(x, y, z))
}
