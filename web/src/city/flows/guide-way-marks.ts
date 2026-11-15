import { Group, Mesh, type ShaderMaterial } from 'three'
import { GUIDE } from '../render/palette'
import { createScreenLines, type LineStyle } from '../render/screen-lines'
import { boardToThree, srgb, type Vec3 } from '../world/units'
import { chevrons, type GuideWay } from './guide-ways'

// The links of a step of the guide's tour, in Jade whatever they are at rest: a band along a
// bridge's deck, a line over a ferry's route, each on a white halo, and chevrons that point to
// the package imported.

const JADE = srgb(GUIDE)
const WHITE = srgb('#FFFFFF')

/** A band on a deck, as a selected folder's, in CSS pixels. */
const BAND: LineStyle = { width: 3.2, colour: JADE }
const BAND_HALO: LineStyle = { width: 6, colour: WHITE, opacity: 0.9 }
/** A ferry's line, its dashes painted on the sea as the ferry lines' own, in u. */
const FERRY: LineStyle = { width: 3, colour: JADE, sceneDash: [1.2, 0.9] }
const FERRY_HALO: LineStyle = { width: 8, colour: WHITE, opacity: 0.75 }
const CHEVRON: LineStyle = { width: 2.4, colour: JADE }
const CHEVRON_HALO: LineStyle = { width: 5.5, colour: WHITE, opacity: 0.9 }
/** Over the bridges, the sea and a selected folder's ways; under the arcs. */
const ORDER = 8

export class GuideWayMarks {
  readonly group = new Group()

  constructor(private readonly pixelRatio: number) {
    this.group.visible = false
  }

  /** Draws these ways, or none. */
  show(ways: readonly GuideWay[] | null): void {
    this.clear()
    if (!ways || ways.length === 0) {
      return
    }
    const three = (path: readonly Vec3[]) => path.map((point) => boardToThree(...point))
    const bands = ways.filter((way) => way.kind === 'bridge').map((way) => three(way.path))
    const lines = ways.filter((way) => way.kind === 'ferry').map((way) => three(way.path))
    const marks = ways.flatMap((way) => chevrons(way.path).map(three))
    const layers: [Vec3[][], LineStyle][] = [
      [bands, BAND_HALO],
      [lines, FERRY_HALO],
      [bands, BAND],
      [lines, FERRY],
      [marks, CHEVRON_HALO],
      [marks, CHEVRON],
    ]
    layers.forEach(([polylines, style], at) => {
      if (polylines.length > 0) {
        const mesh = createScreenLines(polylines, style, this.pixelRatio, false)
        mesh.renderOrder = ORDER + at / layers.length
        this.group.add(mesh)
      }
    })
    this.group.visible = true
  }

  dispose(): void {
    this.clear()
  }

  private clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child)
      if (child instanceof Mesh) {
        child.geometry.dispose()
        ;(child.material as ShaderMaterial).dispose()
      }
    }
    this.group.visible = false
  }
}
