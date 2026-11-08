import { type Port, tipOf } from './links'
import { type ArcLabel, LABEL_HEIGHT, LABEL_LIFT } from './render/arc-mesh'
import { FERRY_LINE } from './render/palette'
import type { IslandLink } from './world/layout'
import { boardToThree, srgb, type Vec3 } from './world/units'

// A port gathers the links its island has no room to draw. A badge at the end of its quay says
// how many (« +17 »); a click lists them and sails them out.

/** The badge stands this far above the end of the quay, in u, its pill higher still. */
const BADGE_RISE = 0.6
/** A port's card lists this many links at most; it counts the rest. */
export const PORT_ROWS = 12
/** Half the width of a badge's pill, in CSS pixels, at most: « +17 ». */
export const BADGE_HALF_WIDTH = 22

/**
 * Whether a badge whose point projects at (x, y) on a view this big, in CSS pixels, still shows
 * some of its pill: the pill stands above the point, as wide as `BADGE_HALF_WIDTH` either side.
 */
export function badgeInView(x: number, y: number, width: number, height: number): boolean {
  return (
    x >= -BADGE_HALF_WIDTH &&
    x <= width + BADGE_HALF_WIDTH &&
    y >= LABEL_LIFT &&
    y <= height + LABEL_LIFT + LABEL_HEIGHT
  )
}

/** Where a port's badge stands: over the end of its quay. */
export function portBadgeAt(port: Port): Vec3 {
  const tip = tipOf(port.quay)
  return boardToThree(tip.x, tip.y, BADGE_RISE)
}

/** The badges of the ports, in their order: a count over each, rimmed in Harbor once hovered. */
export function portLabels(ports: readonly Port[]): ArcLabel[] {
  const colour = srgb(FERRY_LINE)
  return ports.map((port) => ({
    position: portBadgeAt(port),
    text: `+${port.pairs.length}`,
    colour,
  }))
}

/** A link a port gathers, from its island's side. */
export interface PortRow {
  /** The island across. */
  island: number
  imports: number
  /** The port's island imports the other one. */
  outgoing: boolean
  /** The other island imports the port's. */
  incoming: boolean
}

/** The links of a port, the largest first, which way each goes from its island. */
export function portRows(port: Port, links: readonly IslandLink[]): PortRow[] {
  const ways = new Set(
    links.filter((link) => link.imports > 0).map((link) => `${link.from}>${link.to}`),
  )
  const goes = (from: number, to: number) => ways.has(`${from}>${to}`)
  return port.pairs.map((pair) => {
    const island = pair.a === port.island ? pair.b : pair.a
    return {
      island,
      imports: pair.imports,
      outgoing: goes(port.island, island),
      incoming: goes(island, port.island),
    }
  })
}
