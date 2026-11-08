import type { ArcDot, ArcDrawing, ArcLine } from './arc-mesh'
import { arcPoints } from './arc-path'
import { INCOMING_LINK, OUTGOING_LINK, UPWARD } from './palette'
import type { Bundle, Direction, LinkEnd, Linked, SelectionLinks } from './selection-links'
import { srgb, type Vec3 } from './units'

// What the links of a selected file look like: an arc to each linked file, or to a bundle's hub,
// coloured by its direction, red when it goes up the layers.

const COLOURS: Record<Direction, Vec3> = {
  outgoing: srgb(OUTGOING_LINK),
  incoming: srgb(INCOMING_LINK),
}
const RED = srgb(UPWARD)
const WHITE = srgb('#FFFFFF')

/** In CSS pixels. */
const ARC_WIDTH = 2.2
const SOURCE_DOT = 2.6
const TARGET_DOT = 4
const TARGET_RIM = 1.5
/** White dots with a red rim along an arc that goes up the layers, at these shares of it. */
const UPWARD_DOT = 3.4
const UPWARD_RIM = 1
const UPWARD_DOTS = [0.35, 0.65] as const
/** A bundle's hub floats this far above its island's plateau, in u. */
export const HUB_RISE = 4

/** A bundle's width grows with how many files it holds: `2 + 1.4 × log10(n)` CSS pixels. */
export function bundleWidth(files: number): number {
  return 2 + 1.4 * Math.log10(Math.max(files, 1))
}

/** A bundle's hub, where the pointer opens it. */
export interface Hub {
  bundle: Bundle
  position: Vec3
}

export interface SelectionArcs {
  drawing: ArcDrawing
  hubs: Hub[]
}

/**
 * The arcs of a selection standing at `selection` (its roof). `place` tells where a linked end's
 * arc lands; `plateau` how high an island's plateau stands.
 */
export function selectionArcs(
  links: SelectionLinks,
  selection: Vec3,
  place: (end: LinkEnd) => Vec3,
  plateau: (island: number) => number,
): SelectionArcs {
  const lines: ArcLine[] = []
  const dots: ArcDot[] = []
  const hubs: Hub[] = []
  const stems = new Map<Direction, Vec3[][]>()
  const draw = (direction: Direction, there: Vec3, upward: boolean, width: number) => {
    const [source, target] = direction === 'outgoing' ? [selection, there] : [there, selection]
    const points = arcPoints(source, target)
    const colour = upward ? RED : COLOURS[direction]
    lines.push({ points, colour, width, upward })
    dots.push(
      { position: source, colour, size: SOURCE_DOT, rim: 0, rimColour: colour },
      { position: target, colour, size: TARGET_DOT, rim: TARGET_RIM, rimColour: WHITE },
    )
    if (upward) {
      for (const share of UPWARD_DOTS) {
        const at = points[Math.round(share * (points.length - 1))] ?? source
        dots.push({
          position: at,
          colour: WHITE,
          size: UPWARD_DOT,
          rim: UPWARD_RIM,
          rimColour: RED,
        })
      }
    }
  }
  for (const direction of ['outgoing', 'incoming'] as const) {
    const side = links[direction]
    for (const link of side.single) {
      draw(direction, place(link.end), link.upward, ARC_WIDTH)
    }
    for (const bundle of side.bundles) {
      const position = hubOf(bundle.ends, place, plateau(bundle.island))
      hubs.push({ bundle, position })
      draw(direction, position, false, bundleWidth(bundle.ends.length))
      const foot: Vec3 = [position[0], position[1] - HUB_RISE, position[2]]
      stems.set(direction, [...(stems.get(direction) ?? []), [position, foot]])
    }
  }
  return {
    drawing: {
      lines,
      dots,
      stems: [...stems].map(([direction, polylines]) => ({
        colour: COLOURS[direction],
        polylines,
      })),
      labels: hubs.map(({ bundle, position }) => ({
        position,
        text: `${bundle.ends.length} files`,
      })),
    },
    hubs,
  }
}

/** Above the middle of the files it gathers, `HUB_RISE` over their island's plateau. */
function hubOf(ends: readonly Linked[], place: (end: LinkEnd) => Vec3, plateau: number): Vec3 {
  let x = 0
  let z = 0
  for (const { end } of ends) {
    const [px, , pz] = place(end)
    x += px
    z += pz
  }
  const count = Math.max(ends.length, 1)
  return [x / count, plateau + HUB_RISE, z / count]
}
