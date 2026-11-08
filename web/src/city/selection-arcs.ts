import type { ArcDot, ArcDrawing, ArcLabel, ArcLine } from './arc-mesh'
import { ARC_SEGMENTS, arcPoints } from './arc-path'
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
/** A cycle's arcs bend aside by this share of their length: the two ways of a loop part. */
const CYCLE_LEAN = 0.12

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

/** Where things stand around a selection. */
export interface LinkPlaces {
  /** Where an arc to a linked end lands: over its roof. */
  arcEnd(end: LinkEnd): Vec3
  /** Where a linked end stands on the ground: a bundle's hub floats over the middle of its files. */
  ground(end: LinkEnd): Vec3
  /** How high an island's plateau stands. */
  plateau(island: number): number
}

/** The import cycle of a selected file. */
export interface CycleOnShow {
  /** One of the shortest loops through the selection, from it, in import order: buildings. */
  loop: readonly number[]
  /** Every file of the cycle: its badge floats over their middle. */
  members: readonly number[]
}

/** A bundle's count: how many files it holds, or how many more once it was opened. */
export function bundleLabel(bundle: Bundle): string {
  const count = bundle.ends.length
  if (bundle.shown) {
    return `${count} more`
  }
  return count === 1 ? '1 file' : `${count} files`
}

/**
 * The arcs of a selection whose own arcs start at `selection` (over its roof). The links in
 * `fresh` were just opened out of a bundle: their arcs grow out of the selection. The loop of its
 * `cycle`, if any, is drawn in red, in place of its links' arcs along it.
 */
export function selectionArcs(
  links: SelectionLinks,
  selection: Vec3,
  places: LinkPlaces,
  fresh: ReadonlySet<Linked> = new Set(),
  cycle: CycleOnShow | null = null,
): SelectionArcs {
  const lines: ArcLine[] = []
  const dots: ArcDot[] = []
  const hubs: Hub[] = []
  const stems = new Map<Direction, Vec3[][]>()
  const sourceDot = (position: Vec3, colour: Vec3): ArcDot => ({
    position,
    colour,
    size: SOURCE_DOT,
    rim: 0,
    rimColour: colour,
  })
  const targetDot = (position: Vec3, colour: Vec3): ArcDot => ({
    position,
    colour,
    size: TARGET_DOT,
    rim: TARGET_RIM,
    rimColour: WHITE,
  })
  // The selection's own end of its arcs gets one dot of each kind, not one per arc on one point.
  const atSelection = new Map<Direction, ArcDot>()
  const directionDots = (points: readonly Vec3[]) => {
    for (const share of UPWARD_DOTS) {
      const at = points[Math.round(share * (points.length - 1))] ?? selection
      dots.push({
        position: at,
        colour: WHITE,
        size: UPWARD_DOT,
        rim: UPWARD_RIM,
        rimColour: RED,
      })
    }
  }
  const draw = (
    direction: Direction,
    there: Vec3,
    upward: boolean,
    width: number,
    grows = false,
  ) => {
    const outgoing = direction === 'outgoing'
    const [source, target] = outgoing ? [selection, there] : [there, selection]
    const points = arcPoints(source, target)
    const colour = upward ? RED : COLOURS[direction]
    lines.push({ points, colour, width, upward, ...(grows ? { grows: outgoing ? 1 : -1 } : {}) })
    dots.push(outgoing ? targetDot(target, colour) : sourceDot(source, colour))
    if (!atSelection.has(direction)) {
      atSelection.set(direction, outgoing ? sourceDot(source, colour) : targetDot(target, colour))
    }
    if (upward) {
      directionDots(points)
    }
  }
  // The links along the loop are drawn as part of it.
  const loop = cycle && cycle.loop.length >= 2 ? cycle.loop : null
  const alongLoop: Record<Direction, number | undefined> = {
    outgoing: loop?.[1],
    incoming: loop?.at(-1),
  }
  for (const direction of ['outgoing', 'incoming'] as const) {
    const side = links[direction]
    for (const link of side.single) {
      if ('building' in link.end && link.end.building === alongLoop[direction]) {
        continue
      }
      draw(direction, places.arcEnd(link.end), link.upward, ARC_WIDTH, fresh.has(link))
    }
    for (const bundle of side.bundles) {
      const position = hubOf(bundle.ends, places.ground, places.plateau(bundle.island))
      hubs.push({ bundle, position })
      draw(direction, position, false, bundleWidth(bundle.ends.length))
      const foot: Vec3 = [position[0], position[1] - HUB_RISE, position[2]]
      stems.set(direction, [...(stems.get(direction) ?? []), [position, foot]])
    }
  }
  const labels: ArcLabel[] = hubs.map(({ bundle, position }) => ({
    position,
    text: bundleLabel(bundle),
    colour: COLOURS[bundle.direction],
  }))
  if (loop && cycle) {
    const ends = loop.map((building, at) => (at === 0 ? selection : places.arcEnd({ building })))
    ends.forEach((start, at) => {
      const end = ends[(at + 1) % ends.length] ?? selection
      const points = arcPoints(start, end, ARC_SEGMENTS, CYCLE_LEAN)
      lines.push({ points, colour: RED, width: ARC_WIDTH, upward: false, solid: true })
      directionDots(points)
      if (at > 0) {
        dots.push(targetDot(start, RED))
      }
    })
    labels.push({
      position: badgeOf(cycle.members, places.ground),
      text: `Cycle · ${cycle.members.length} files`,
      colour: RED,
      rimmed: true,
    })
  }
  return {
    drawing: {
      lines,
      dots: [...dots, ...atSelection.values()],
      stems: [...stems].map(([direction, polylines]) => ({
        colour: COLOURS[direction],
        polylines,
      })),
      labels,
    },
    hubs,
  }
}

/** Over the middle of a cycle's files, as high above the highest foot as a hub over its plateau. */
function badgeOf(members: readonly number[], ground: (end: LinkEnd) => Vec3): Vec3 {
  let x = 0
  let z = 0
  let top = Number.NEGATIVE_INFINITY
  for (const building of members) {
    const [px, py, pz] = ground({ building })
    x += px
    z += pz
    top = Math.max(top, py)
  }
  const count = Math.max(members.length, 1)
  return [x / count, (Number.isFinite(top) ? top : 0) + HUB_RISE, z / count]
}

/** Above the middle of the files it gathers, `HUB_RISE` over their island's plateau. */
function hubOf(ends: readonly Linked[], ground: (end: LinkEnd) => Vec3, plateau: number): Vec3 {
  let x = 0
  let z = 0
  for (const { end } of ends) {
    const [px, , pz] = ground(end)
    x += px
    z += pz
  }
  const count = Math.max(ends.length, 1)
  return [x / count, plateau + HUB_RISE, z / count]
}
