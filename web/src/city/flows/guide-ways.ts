import { deckLine } from '../waterways/bridges'
import type { Bridge, Ferry, Pair, Port } from '../waterways/links'
import type { CityLayout, IslandLink } from '../world/layout'
import type { Vec3 } from '../world/units'
import type { ExtraFerries } from './extra-ferries'

// The ways the links of a step of the guide's tour take between islands: the bridge or the ferry
// line between the two, or the line a port gathers sailed out of it; each from the importing
// island to the imported one, the way its chevrons point.

/** A link of the guide between islands: from the nearest of `from` that imports `to`. */
export interface GuideWayLink {
  from: readonly number[]
  to: number
}

/** The way of a link, in board coordinates (x, y on the sea, z up), from importer to imported. */
export interface GuideWay {
  /** The indexes of the links it carries: two links between the same islands share it. */
  links: number[]
  kind: 'bridge' | 'ferry'
  path: Vec3[]
  /** The pair a port gathers, sailed out of it for the while. */
  fromPort: Pair | null
}

/** Over the deck's top, as a selected folder's bands, in u. */
const BAND_RISE = 0.05
/** Over the ferry lines (0.04 u) and a selected folder's (0.06 u), in u. */
const FERRY_ALTITUDE = 0.07
/** Chevrons stand at these shares of a way, its count at the middle. */
export const CHEVRONS_AT = [0.3, 0.55, 0.8] as const
/** A chevron's branches, in u, and how wide they open from the way, in radians. */
const BRANCH = 1.4
const OPENING = Math.PI / 4

const key = (a: number, b: number) => `${Math.min(a, b)}/${Math.max(a, b)}`

/**
 * The ways of these links, in their order, one for each pair of islands from importer to
 * imported; none for a link the islands have no way between.
 */
export function guideWays(
  links: readonly GuideWayLink[],
  layout: CityLayout,
  city: {
    bridges: readonly Bridge[]
    ferries: readonly Ferry[]
    unshown: readonly Pair[]
    ports: readonly Port[]
    extra: ExtraFerries | undefined
  },
): GuideWay[] {
  const bridges = new Map(city.bridges.map((bridge) => [key(bridge.a, bridge.b), bridge]))
  const ferries = new Map(city.ferries.map((ferry) => [key(ferry.a, ferry.b), ferry]))
  const unshown = new Map(city.unshown.map((pair) => [key(pair.a, pair.b), pair]))
  const found = new Map<string, GuideWay>()
  links.forEach((link, index) => {
    const from = nearestImporter(link, layout)
    const way = from === null ? undefined : found.get(`${from}>${link.to}`)
    if (way) {
      way.links.push(index)
    } else if (from !== null) {
      const made = wayOf(from, link.to, index)
      if (made) {
        found.set(`${from}>${link.to}`, made)
      }
    }
  })
  return [...found.values()]

  function wayOf(from: number, to: number, index: number): GuideWay | null {
    const id = key(from, to)
    const bridge = bridges.get(id)
    if (bridge) {
      const path = deckLine(bridge, 0, BAND_RISE)
      return {
        links: [index],
        kind: 'bridge',
        path: from === bridge.low ? path : path.reverse(),
        fromPort: null,
      }
    }
    const pair = unshown.get(id)
    const port = pair && city.ports.find((each) => each.pairs.includes(pair))
    const ferry = ferries.get(id) ?? (pair && city.extra?.route(pair, port))
    if (!ferry) {
      return null
    }
    const path = ferry.path.map(({ x, y }): Vec3 => [x, y, FERRY_ALTITUDE])
    return {
      links: [index],
      kind: 'ferry',
      path: from === ferry.a ? path : path.reverse(),
      fromPort: port && pair ? pair : null,
    }
  }
}

/**
 * Of the islands a link starts from, the nearest to the one it goes to among those that import
 * it; null if none does.
 */
export function nearestImporter(link: GuideWayLink, layout: CityLayout): number | null {
  const imports = new Set(
    (layout.links ?? [])
      .filter((each: IslandLink) => each.to === link.to && each.imports > 0)
      .map((each) => each.from),
  )
  const centre = (island: number) => {
    const plateau = layout.islands[island]?.plateau
    return plateau && { x: plateau.x + plateau.width / 2, y: plateau.y + plateau.height / 2 }
  }
  const to = centre(link.to)
  let best: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const island of link.from) {
    const at = centre(island)
    if (!imports.has(island) || !at || !to) {
      continue
    }
    const distance = Math.hypot(at.x - to.x, at.y - to.y)
    if (distance < bestDistance) {
      best = island
      bestDistance = distance
    }
  }
  return best
}

/** The point at this share of a path's length, and the way it heads there on the sea. */
export function alongPath(
  path: readonly Vec3[],
  share: number,
): { at: Vec3; dx: number; dy: number } {
  const lengths = path.slice(1).map((point, at) => {
    const [x, y] = path[at] ?? point
    return Math.hypot(point[0] - x, point[1] - y)
  })
  const total = lengths.reduce((sum, length) => sum + length, 0)
  let left = share * total
  for (let at = 0; at < lengths.length; at += 1) {
    const length = lengths[at] ?? 0
    const start = path[at]
    const end = path[at + 1]
    if (start && end && (left <= length || at === lengths.length - 1)) {
      const t = length > 0 ? Math.min(left / length, 1) : 0
      const dx = (end[0] - start[0]) / (length || 1)
      const dy = (end[1] - start[1]) / (length || 1)
      return {
        at: [
          start[0] + (end[0] - start[0]) * t,
          start[1] + (end[1] - start[1]) * t,
          start[2] + (end[2] - start[2]) * t,
        ],
        dx,
        dy,
      }
    }
    left -= length
  }
  const only = path[0] ?? [0, 0, 0]
  return { at: [...only], dx: 1, dy: 0 }
}

/** The chevrons of a way, each a line of three points, its tip toward the way's end. */
export function chevrons(path: readonly Vec3[]): Vec3[][] {
  return CHEVRONS_AT.map((share) => {
    const { at, dx, dy } = alongPath(path, share)
    const branch = (side: 1 | -1): Vec3 => {
      const cos = Math.cos(OPENING)
      const sin = Math.sin(OPENING) * side
      // Back along the way, turned to either side
      const bx = -(dx * cos - dy * sin)
      const by = -(dx * sin + dy * cos)
      return [at[0] + bx * BRANCH, at[1] + by * BRANCH, at[2]]
    }
    return [branch(1), at, branch(-1)]
  })
}
