import type { WebGLInfo } from 'three'
import type { DecorStats } from '../decor/decor-mesh'

export interface FrameStats {
  fps: number
  drawCalls: number
  triangles: number
  /** Trees, rocks and boats of the city, and their triangles at full size. */
  decor: DecorStats
  links: LinkStats
  /** How long the last search for what the pointer rests on took, in ms. */
  pickMs: number
}

/** How the imports between islands are drawn. */
export interface LinkStats {
  bridges: number
  ferries: number
  /** Links gathered at a port, not drawn. */
  inPorts: number
  /** Links not drawn: too small while nothing is selected, or with no way by water. */
  hidden: number
}

export const NO_LINKS: LinkStats = { bridges: 0, ferries: 0, inPorts: 0, hidden: 0 }

/** Counts the frames drawn, and what the last one drew. */
export class FrameCounter {
  readonly stats: FrameStats = {
    fps: 0,
    drawCalls: 0,
    triangles: 0,
    decor: { instances: 0, triangles: 0 },
    links: NO_LINKS,
    pickMs: 0,
  }
  private framesSince = 0
  private statsSince = 0

  /** A frame was drawn. */
  drawn(info: WebGLInfo, decor: DecorStats, links: LinkStats): void {
    this.framesSince++
    this.stats.drawCalls = info.render.calls
    this.stats.triangles = info.render.triangles
    this.stats.decor = decor
    this.stats.links = links
  }

  /** Works the frame rate out again every half second. */
  tick(time: number): void {
    const elapsed = time - this.statsSince
    if (elapsed >= 500) {
      this.stats.fps = Math.round((this.framesSince * 1000) / elapsed)
      this.framesSince = 0
      this.statsSince = time
    }
  }
}
