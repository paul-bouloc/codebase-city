import type { Group } from 'three'
import { GuideWayMarks } from '../flows/guide-way-marks'
import { alongPath, type GuideWay, guideWays } from '../flows/guide-ways'
import type { Pair, Port } from '../waterways/links'
import type { CityLayout } from '../world/layout'
import { boardToThree, type Vec3 } from '../world/units'
import type { CityGuideLink, GuideLinkLabel } from './city-guide'
import type { CityFlows } from './city-items'
import type { OpenPort } from './open-port'

/** The count of a link of the guide, at the middle of its way. */
export interface GuideLinkCount extends GuideLinkLabel {
  /** The same for the same link. */
  key: string
  anchor: Vec3
  /** Its place among the counts of the links that share its way, from the top. */
  stack: number
}

const NONE: readonly GuideLinkCount[] = []

/**
 * The links a step of the guide's tour shows between islands: their ways in Jade, their counts,
 * and the ports they sail out of. A selection takes their place while it lasts.
 */
export class GuideLinkWays {
  private readonly marks: GuideWayMarks
  private ways: GuideWay[] = []
  private all: GuideLinkCount[] = []
  private hidden = false
  /** The links sailed out of their ports. */
  private out = new Set<Pair>()

  constructor(
    private readonly layout: CityLayout,
    private readonly flows: CityFlows,
    private readonly ports: OpenPort,
    /** Closes the open port, its card with it, when one of its links sails out or comes back. */
    private readonly closePort: () => void,
    pixelRatio: number,
  ) {
    this.marks = new GuideWayMarks(pixelRatio)
  }

  get group(): Group {
    return this.marks.group
  }

  /** Shows these links, or none. */
  show(links: readonly CityGuideLink[]): void {
    const { bridges, ferries, unshown = [], ports = [], extra } = this.flows
    this.ways = guideWays(links, this.layout, { bridges, ferries, unshown, ports, extra })
    this.all = this.ways.flatMap((way) => {
      const [x, y, z] = alongPath(way.path, 0.5).at
      const anchor = boardToThree(x, y, z)
      return way.links.flatMap((index, stack) => {
        const link = links[index]
        return link ? [{ key: `link\n${index}`, anchor, stack, ...link.label }] : []
      })
    })
    this.draw()
  }

  /** Hides the links while a selection lasts, or shows them again. */
  setHidden(hidden: boolean): void {
    if (hidden !== this.hidden) {
      this.hidden = hidden
      this.draw()
    }
  }

  /** The counts on show, at the middle of each way. */
  counts(): readonly GuideLinkCount[] {
    return this.hidden ? NONE : this.all
  }

  dispose(): void {
    this.marks.dispose()
  }

  private draw(): void {
    const ways = this.hidden ? [] : this.ways
    this.marks.show(ways)
    const out = new Set<Pair>(ways.flatMap((way) => (way.fromPort ? [way.fromPort] : [])))
    const same = out.size === this.out.size && [...out].every((pair) => this.out.has(pair))
    if (!same) {
      if (portChanges(this.ports.port, this.out, out)) {
        this.closePort()
      }
      this.out = out
      this.ports.sailOut(out)
    }
  }
}

/** Whether a link of this port sails out or comes back between these two sets of links out. */
export function portChanges(
  port: Port | null,
  before: ReadonlySet<Pair>,
  after: ReadonlySet<Pair>,
): boolean {
  return port?.pairs.some((pair) => before.has(pair) !== after.has(pair)) ?? false
}
