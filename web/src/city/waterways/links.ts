import type { IslandShape, Side } from '../terrain/island-shape'
import { boundsOf, type CityLayout, type IslandLink, type Point } from '../world/layout'
import { boats } from './boat-places'
import { bridgeFor } from './bridge-placement'
import { bridgeSides, decksOn, mouthsOn, openSide, SIDES, sideToward } from './island-sides'
import { loneQuay, quayAt, quayStretch, tipOf } from './quays'
import { landOutline, type WaterGrid, waterGrid } from './water-grid'
import { ferryRoute } from './water-route'

// Imports between islands become works the city always shows. Two neighbours at most one layer
// apart, face to face across one channel, get a stone bridge; every other pair a ferry line on
// the water. An island keeps a few of each, the largest first; the rest are counted at its port.
// Links that go up the layers are never hidden.

const MAX_BRIDGES_PER_SIDE = 3
const MAX_FERRIES_PER_ISLAND = 4
/** Links smaller than this share of the largest are hidden while nothing is selected. */
const SMALL_LINK = 0.01

/** A city this small gets a quay and two boats even without ferries. */
const SMALL_CITY = 50

/** Both ways between two islands, `a` the lower index. */
export interface Pair {
  a: number
  b: number
  imports: number
  /** Whether an import goes up the layers, either way. */
  upward: boolean
}

export interface Bridge extends Pair {
  /** `x`: the deck runs east-west, from the west island to the east one; `y`: south-north. */
  axis: 'x' | 'y'
  /** The island on the west (or south) bank, and the one across. */
  low: number
  high: number
  /** The deck's centre line, across the channel: y for an `x` bridge, x for a `y` one. */
  at: number
  /** Where the deck lands on each plateau's edge, along the axis. */
  start: number
  end: number
  /** The plateaux' altitudes at each end. */
  startZ: number
  endZ: number
  width: number
}

export interface Quay {
  island: number
  side: Side
  /** Where it starts, up the beach, and the way out to sea. */
  x: number
  y: number
  nx: number
  ny: number
  length: number
  width: number
  /** A port's quay; a ferry's pier otherwise. */
  port: boolean
}

export interface Ferry extends Pair {
  /** From the pier of `a` to the pier of `b`, by water. */
  path: Point[]
}

export interface Port {
  island: number
  /** The links it gathers, not drawn, the largest first. */
  pairs: Pair[]
  quay: Quay
}

export interface Boat {
  x: number
  y: number
  /** Heading, in radians from the east, counter-clockwise. */
  angle: number
  seed: number
  /** A boat that sails a ferry line: its index in `ferries`, and the share of the way it starts at. */
  line?: { ferry: number; share: number }
}

export interface CityLinks {
  bridges: Bridge[]
  ferries: Ferry[]
  quays: Quay[]
  ports: Port[]
  boats: Boat[]
  /** Links gathered at a port, each once even when both its islands' ports count it. */
  inPorts: number
  /** Links not drawn: too small while nothing is selected, or with no way by water. */
  hidden: number
  /** Every pair not drawn, at a port, too small or with no way by water; the largest first. */
  unshown: Pair[]
  /** The water the ferries were routed on, if any, with their traffic: more lines can follow. */
  grid: WaterGrid | null
}

/** Both ways between two islands as one pair; the largest first. */
export function linkPairs(links: readonly IslandLink[]): Pair[] {
  const pairs = new Map<string, Pair>()
  for (const link of links) {
    if (link.from === link.to) {
      continue
    }
    const a = Math.min(link.from, link.to)
    const b = Math.max(link.from, link.to)
    const key = `${a}/${b}`
    const pair = pairs.get(key) ?? { a, b, imports: 0, upward: false }
    pair.imports += link.imports
    pair.upward ||= link.upward > 0
    pairs.set(key, pair)
  }
  return [...pairs.values()].sort((p, q) => q.imports - p.imports || p.a - q.a || p.b - q.b)
}

/** The bridges, ferries, quays, ports and boats of a city; `shapes` in the islands' order. */
export function cityLinks(layout: CityLayout, shapes: readonly IslandShape[]): CityLinks {
  const pairs = linkPairs(layout.links ?? [])
  const largest = pairs[0]?.imports ?? 0
  const outlines = shapes.map((shape) => landOutline(shape))
  const plateaux = layout.islands.map((island) => island.plateau)
  const result: CityLinks = {
    bridges: [],
    ferries: [],
    quays: [],
    ports: [],
    boats: [],
    inPorts: 0,
    hidden: 0,
    unshown: [],
    grid: null,
  }

  const perSide = new Map<string, number>()
  const ferriesOf = new Map<number, number>()
  const portLinks = new Map<number, Pair[]>()
  const toPort = (island: number, pair: Pair) => {
    const gathered = portLinks.get(island)
    if (gathered) {
      gathered.push(pair)
    } else {
      portLinks.set(island, [pair])
    }
  }
  const unshown = new Set<Pair>()
  const sailing: Pair[] = []

  for (const pair of pairs) {
    if (!pair.upward && pair.imports < SMALL_LINK * largest) {
      result.hidden++
      unshown.add(pair)
      continue
    }
    const bridge = bridgeFor(pair, layout, plateaux, shapes, outlines)
    if (bridge) {
      const sides = bridgeSides(bridge)
      const full = sides.filter((side) => (perSide.get(side) ?? 0) >= MAX_BRIDGES_PER_SIDE)
      if (full.length === 0 || pair.upward) {
        for (const side of sides) {
          perSide.set(side, (perSide.get(side) ?? 0) + 1)
        }
        result.bridges.push(bridge)
      } else {
        for (const side of full) {
          toPort(Number(side.split('/')[0]), pair)
        }
        result.inPorts++
        unshown.add(pair)
      }
      continue
    }
    const full = [pair.a, pair.b].filter(
      (island) => (ferriesOf.get(island) ?? 0) >= MAX_FERRIES_PER_ISLAND,
    )
    if (full.length > 0 && !pair.upward) {
      for (const island of full) {
        toPort(island, pair)
      }
      result.inPorts++
      unshown.add(pair)
      continue
    }
    ferriesOf.set(pair.a, (ferriesOf.get(pair.a) ?? 0) + 1)
    ferriesOf.set(pair.b, (ferriesOf.get(pair.b) ?? 0) + 1)
    sailing.push(pair)
  }

  // The quays: a pier on each side of an island its ferries leave from, each toward where they
  // go; its port on the side that looks out the farthest.
  const ends = sailing.map((pair) => ({
    a: sideToward(plateaux, pair.a, pair.b),
    b: sideToward(plateaux, pair.b, pair.a),
  }))
  const used = new Map<number, Set<Side>>()
  sailing.forEach((pair, index) => {
    const end = ends[index]
    if (end) {
      used.set(pair.a, (used.get(pair.a) ?? new Set()).add(end.a))
      used.set(pair.b, (used.get(pair.b) ?? new Set()).add(end.b))
    }
  })
  const harbours = [...new Set([...used.keys(), ...portLinks.keys()])].sort((p, q) => p - q)
  const piers = new Map<string, Quay>()
  for (const island of harbours) {
    const shape = shapes[island]
    if (!shape) {
      continue
    }
    const portSide = portLinks.has(island) ? openSide(plateaux, island) : null
    for (const side of SIDES) {
      const items = [
        ...(used.get(island)?.has(side) ? ['pier' as const] : []),
        ...(portSide === side ? ['port' as const] : []),
      ]
      const taken = [...mouthsOn(shape, side), ...decksOn(result.bridges, island, side)]
      items.forEach((item, index) => {
        const port = item === 'port'
        const share = (index + 1) / (items.length + 1)
        const quay = quayAt(shape, island, side, share, port, plateaux, taken)
        taken.push(quayStretch(quay))
        result.quays.push(quay)
        if (port) {
          result.ports.push({ island, pairs: portLinks.get(island) ?? [], quay })
        } else {
          piers.set(`${island}/${side}`, quay)
        }
      })
    }
  }

  if (sailing.length > 0) {
    // The largest first: they take the best water, the smaller ones sail beside them.
    const grid = waterGrid(shapes, boundsOf(plateaux))
    result.grid = grid
    const sailed = new Set<Quay>()
    sailing.forEach((pair, index) => {
      const end = ends[index]
      const from = end && piers.get(`${pair.a}/${end.a}`)
      const to = end && piers.get(`${pair.b}/${end.b}`)
      const path =
        from && to
          ? ferryRoute(grid, tipOf(from), { x: from.nx, y: from.ny }, tipOf(to), {
              x: to.nx,
              y: to.ny,
            })
          : null
      if (!from || !to || !path) {
        result.hidden++
        unshown.add(pair)
        return
      }
      sailed.add(from).add(to)
      result.ferries.push({ ...pair, path })
    })
    // A pier no line leaves from has nothing to show.
    result.quays = result.quays.filter((quay) => quay.port || sailed.has(quay))
  }

  const files = layout.islands.reduce((sum, island) => sum + island.lots.length, 0)
  if (files < SMALL_CITY && result.quays.length === 0 && shapes.length > 0) {
    const lone = loneQuay(layout, shapes, result.bridges)
    if (lone) {
      result.quays.push(lone)
    }
  }
  // In the pairs' order: the largest first.
  result.unshown = pairs.filter((pair) => unshown.has(pair))
  result.boats = boats(result, layout)
  return result
}
