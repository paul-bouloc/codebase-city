import { Color, Group } from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { Ferry } from './links'
import { FERRY_WAKE, UPWARD } from './palette'
import { boardToThree } from './units'

// A ferry line is a dashed wake on the water: as wide on screen whatever the zoom, its dashes
// laid on the sea in u, so that they stay put while the camera moves.

/** Just above the sea and the foam (0.02 u). */
const WAKE_ALTITUDE = 0.04
const DASH = { dash: 1.2, gap: 0.8 }
/** A link that goes up: red, in shorter dashes. */
const UPWARD_DASH = { dash: 0.6, gap: 0.5 }

/** Every ferry line of the city, one draw call each: their widths differ. */
export function createFerries(ferries: readonly Ferry[], pixelRatio: number): Group {
  const group = new Group()
  for (const ferry of ferries) {
    const geometry = new LineGeometry()
    geometry.setPositions(ferry.path.flatMap(({ x, y }) => boardToThree(x, y, WAKE_ALTITUDE)))
    const dashes = ferry.upward ? UPWARD_DASH : DASH
    const material = new LineMaterial({
      color: new Color(ferry.upward ? UPWARD : FERRY_WAKE),
      // The viewport is in device pixels.
      linewidth: ferry.pixels * pixelRatio,
      worldUnits: false,
      dashed: true,
      dashSize: dashes.dash,
      gapSize: dashes.gap,
    })
    // Laid on the water: nothing below it to hide, and the foam must not fight it for depth.
    material.depthWrite = false
    const line = new Line2(geometry, material)
    line.computeLineDistances()
    group.add(line)
  }
  return group
}
