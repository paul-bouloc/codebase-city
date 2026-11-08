import type { IslandShape, Side } from './island-shape'
import { ferryRoute, insidePolygon, landOutline, type WaterGrid, waterGrid } from './water-route'
import { boundsOf, type CityLayout, type IslandLink, type Point, type Rect } from './world/layout'
import { seededRandom } from './world/random'
import { layerAltitude } from './world/units'

// Imports between islands become works the city always shows. Two neighbours at most one layer
// apart, face to face across one channel, get a stone bridge; every other pair a ferry line on
// the water. An island keeps a few of each, the largest first; the rest are counted at its port.
// Links that go up the layers are never hidden.

/** A bridge spans a channel this wide at most: the layout's widest. */
const MAX_CHANNEL = 24
/** Room kept between a deck and a canal's mouth, or the end of the sides it lands on. */
const LANDING_CLEARANCE = 2
/** Room kept between a deck and a third island's land. */
const DECK_CLEARANCE = 0.5
/** Landing positions are tried this far apart, outward from the one wanted. */
const LANDING_STEP = 0.25
const MAX_BRIDGES_PER_SIDE = 3
const MAX_FERRIES_PER_ISLAND = 4
/** Links smaller than this share of the largest are hidden while nothing is selected. */
const SMALL_LINK = 0.01

/** A ferry's pier: from the beach out into the water. */
const PIER = { width: 0.6, length: 2.4 }
/** A port's quay, broader and longer: it gathers the links an island has no room to draw. */
const PORT_QUAY = { width: 1.4, length: 3.4 }
/** How far up the beach a quay starts. */
const QUAY_ROOT = 0.8
/** Boats moored on each side of a quay, this far from its axis, this far out. */
const MOORING = { across: 0.85, out: 1.5 }
/**
 * A quay keeps to its half of the water ahead, and the line's room in the middle: it may shrink
 * to this, past the beach. Boats moor only at a quay that reaches this far.
 */
const QUAY_MIN = 0.8
const MOORING_MIN = 2
const MID_CHANNEL = 0.5
/** A city this small gets a quay and two boats even without ferries. */
const SMALL_CITY = 50

/** A side looks out to sea as far as this, in u, at most; farther makes no difference. */
const OPEN_ENOUGH = 30
/** How much a pier prefers a side that looks out to sea over one that faces the other island. */
const OPENNESS_WEIGHT = 0.6

/** Width of a bridge's deck, in u, from the imports it carries. */
export function deckWidth(imports: number): number {
  return Math.min(4.6, 0.6 + 0.9 * Math.log10(imports + 1))
}

/** Boats along a ferry line: one per order of magnitude of its imports. */
export function boatsFor(imports: number): number {
  return Math.max(1, Math.floor(Math.log10(Math.max(imports, 1))) + 1)
}

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

/**
 * The side of an island that looks out the farthest: open sea if one does, else the widest
 * channel; the west first when two look alike.
 */
function openSide(plateaux: readonly Rect[], island: number): Side {
  return SIDES.reduce((best, side) =>
    lookout(plateaux, island, side) > lookout(plateaux, island, best) ? side : best,
  )
}

const SIDES: Side[] = ['west', 'east', 'south', 'north']

/** How far a side of an island looks out before another island: infinite on the open sea. */
function lookout(plateaux: readonly Rect[], island: number, side: Side): number {
  const plateau = plateaux[island]
  if (!plateau) {
    return 0
  }
  let nearest = Number.POSITIVE_INFINITY
  plateaux.forEach((other, index) => {
    if (index === island) {
      return
    }
    const gap = {
      west: plateau.x - (other.x + other.width),
      east: other.x - (plateau.x + plateau.width),
      south: plateau.y - (other.y + other.height),
      north: other.y - (plateau.y + plateau.height),
    }[side]
    const across =
      side === 'west' || side === 'east'
        ? other.y < plateau.y + plateau.height && plateau.y < other.y + other.height
        : other.x < plateau.x + plateau.width && plateau.x < other.x + other.width
    if (gap > 0 && across) {
      nearest = Math.min(nearest, gap)
    }
  })
  return nearest
}

/**
 * The side of an island a ferry to another one leaves from: the one that turns most toward it,
 * a side that looks out to sea preferred to one facing a neighbour across a channel.
 */
function sideToward(plateaux: readonly Rect[], island: number, target: number): Side {
  const from = plateaux[island]
  const to = plateaux[target]
  if (!from || !to) {
    return 'west'
  }
  const dx = to.x + to.width / 2 - (from.x + from.width / 2)
  const dy = to.y + to.height / 2 - (from.y + from.height / 2)
  const length = Math.hypot(dx, dy) || 1
  const score = (side: Side) => {
    const [nx, ny] = NORMALS[side]
    const open = Math.min(lookout(plateaux, island, side), OPEN_ENOUGH) / OPEN_ENOUGH
    return (nx * dx + ny * dy) / length + OPENNESS_WEIGHT * open
  }
  return SIDES.reduce((best, side) => (score(side) > score(best) + 1e-9 ? side : best))
}

function bridgeSides(bridge: Bridge): string[] {
  return bridge.axis === 'x'
    ? [`${bridge.low}/east`, `${bridge.high}/west`]
    : [`${bridge.low}/north`, `${bridge.high}/south`]
}

/** Where bridges land on a side of an island, along that side. */
function decksOn(bridges: readonly Bridge[], island: number, side: Side): [number, number][] {
  return bridges
    .filter((bridge) => bridgeSides(bridge).includes(`${island}/${side}`))
    .map((bridge) => [bridge.at - bridge.width / 2, bridge.at + bridge.width / 2])
}

/** The stretch of its side a quay takes. */
function quayStretch(quay: Quay): [number, number] {
  const along = quay.nx !== 0 ? quay.y : quay.x
  return [along - quay.width / 2, along + quay.width / 2]
}

/** Two plateaux face to face across one channel, and the stretch where they do. */
interface Facing {
  axis: 'x' | 'y'
  low: number
  high: number
  start: number
  end: number
  /** The overlap of the facing sides. */
  from: number
  to: number
}

function facing(a: number, b: number, plateaux: readonly Rect[]): Facing | null {
  const p = plateaux[a]
  const q = plateaux[b]
  if (!p || !q) {
    return null
  }
  for (const axis of ['x', 'y'] as const) {
    const [low, high] = axis === 'x' ? (p.x <= q.x ? [a, b] : [b, a]) : p.y <= q.y ? [a, b] : [b, a]
    const l = plateaux[low] as Rect
    const h = plateaux[high] as Rect
    const start = axis === 'x' ? l.x + l.width : l.y + l.height
    const end = axis === 'x' ? h.x : h.y
    const from = axis === 'x' ? Math.max(l.y, h.y) : Math.max(l.x, h.x)
    const to =
      axis === 'x'
        ? Math.min(l.y + l.height, h.y + h.height)
        : Math.min(l.x + l.width, h.x + h.width)
    if (end > start && end - start <= MAX_CHANNEL && to > from) {
      return { axis, low, high, start, end, from, to }
    }
  }
  return null
}

/** The bridge a pair gets, if its islands are close neighbours with room to land one. */
function bridgeFor(
  pair: Pair,
  layout: CityLayout,
  plateaux: readonly Rect[],
  shapes: readonly IslandShape[],
  outlines: readonly Point[][],
): Bridge | null {
  const islands = layout.islands
  const layerA = islands[pair.a]?.layer ?? 1
  const layerB = islands[pair.b]?.layer ?? 1
  if (Math.abs(layerA - layerB) > 1) {
    return null
  }
  const face = facing(pair.a, pair.b, plateaux)
  if (!face) {
    return null
  }
  const width = deckWidth(pair.imports)
  const lowest = face.from + LANDING_CLEARANCE + width / 2
  const highest = face.to - LANDING_CLEARANCE - width / 2
  if (highest < lowest) {
    return null
  }
  const lowSide: Side = face.axis === 'x' ? 'east' : 'north'
  const highSide: Side = face.axis === 'x' ? 'west' : 'south'
  const mouths = [...mouthsOn(shapes[face.low], lowSide), ...mouthsOn(shapes[face.high], highSide)]
  // Third islands whose land may reach into the channel.
  const others = outlines.filter(
    (_, index) =>
      index !== face.low &&
      index !== face.high &&
      overlapsRect(
        grow(plateaux[index] as Rect, shapes[index]?.reach ?? 0),
        corridor(face, face.from, face.to),
      ),
  )
  const wanted = Math.min(Math.max(landingTarget(layout, face, lowSide, highSide), lowest), highest)
  const fits = (at: number) => {
    const deck: [number, number] = [at - width / 2, at + width / 2]
    if (
      mouths.some(
        ([m0, m1]) => deck[1] > m0 - LANDING_CLEARANCE && deck[0] < m1 + LANDING_CLEARANCE,
      )
    ) {
      return false
    }
    const strip = corridor(face, deck[0] - DECK_CLEARANCE, deck[1] + DECK_CLEARANCE)
    return others.every((outline) => !polygonHitsRect(outline, strip))
  }
  const steps = Math.ceil((highest - lowest) / LANDING_STEP)
  for (let k = 0; k <= 2 * steps; k++) {
    const offset = Math.ceil(k / 2) * LANDING_STEP * (k % 2 === 0 ? 1 : -1)
    const at = wanted + offset
    if (at < lowest - 1e-9 || at > highest + 1e-9) {
      continue
    }
    if (fits(at)) {
      return {
        ...pair,
        axis: face.axis,
        low: face.low,
        high: face.high,
        at,
        start: face.start,
        end: face.end,
        startZ: layerAltitude(islands[face.low]?.layer ?? 1),
        endZ: layerAltitude(islands[face.high]?.layer ?? 1),
        width,
      }
    }
  }
  return null
}

/** The channel between two facing plateaux, over a stretch of their overlap. */
function corridor(face: Facing, from: number, to: number): Rect {
  return face.axis === 'x'
    ? { x: face.start, y: from, width: face.end - face.start, height: to - from }
    : { x: from, y: face.start, width: to - from, height: face.end - face.start }
}

/**
 * Where a deck would rather land: on each bank, the middle of the folder nearest the channel
 * within the overlap; between the two banks' if both have one.
 */
function landingTarget(layout: CityLayout, face: Facing, lowSide: Side, highSide: Side): number {
  const targets = [
    nearestParcel(layout, face.low, lowSide, face),
    nearestParcel(layout, face.high, highSide, face),
  ].filter((target) => target !== null)
  if (targets.length === 0) {
    return (face.from + face.to) / 2
  }
  return targets.reduce((sum, target) => sum + target, 0) / targets.length
}

function nearestParcel(
  layout: CityLayout,
  island: number,
  side: Side,
  face: Facing,
): number | null {
  const layoutOf = layout.islands[island]
  if (!layoutOf) {
    return null
  }
  const rects = [
    ...layoutOf.parcels.filter((parcel) => parcel.level === 1).map((parcel) => parcel.rect),
    ...(layoutOf.square ? [layoutOf.square] : []),
  ]
  const middle = (face.from + face.to) / 2
  let best: { distance: number; off: number; centre: number } | null = null
  for (const rect of rects) {
    const [r0, r1] =
      face.axis === 'x' ? [rect.y, rect.y + rect.height] : [rect.x, rect.x + rect.width]
    if (r1 <= face.from || r0 >= face.to) {
      continue
    }
    // How far the parcel stands back from the channel.
    const edge = {
      east: rect.x + rect.width,
      west: -rect.x,
      north: rect.y + rect.height,
      south: -rect.y,
    }[side]
    const distance = -edge
    const centre = (Math.max(r0, face.from) + Math.min(r1, face.to)) / 2
    const off = Math.abs(centre - middle)
    if (
      !best ||
      distance < best.distance - 1e-6 ||
      (Math.abs(distance - best.distance) <= 1e-6 && off < best.off)
    ) {
      best = { distance, off, centre }
    }
  }
  return best?.centre ?? null
}

/** The stretches of a side where canals pour over the edge, along that side. */
function mouthsOn(shape: IslandShape | undefined, side: Side): [number, number][] {
  if (!shape) {
    return []
  }
  return shape.canals.cells
    .filter((cell) => cell.mouth === side)
    .map(({ rect }) =>
      side === 'east' || side === 'west'
        ? [rect.y, rect.y + rect.height]
        : [rect.x, rect.x + rect.width],
    )
}

function grow(rect: Rect, by: number): Rect {
  return {
    x: rect.x - by,
    y: rect.y - by,
    width: rect.width + 2 * by,
    height: rect.height + 2 * by,
  }
}

function overlapsRect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function insideRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

/** Whether a polygon and a rectangle share any ground. */
function polygonHitsRect(polygon: readonly Point[], rect: Rect): boolean {
  const corners: Point[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ]
  if (polygon.some((point) => insideRect(point, rect))) {
    return true
  }
  if (corners.some((corner) => insidePolygon(corner, polygon))) {
    return true
  }
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    for (let k = 0; k < 4; k++) {
      if (
        segmentsCross(
          polygon[j] as Point,
          polygon[i] as Point,
          corners[k] as Point,
          corners[(k + 1) % 4] as Point,
        )
      ) {
        return true
      }
    }
  }
  return false
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const turn = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const d1 = turn(c, d, a)
  const d2 = turn(c, d, b)
  const d3 = turn(a, b, c)
  const d4 = turn(a, b, d)
  return d1 * d2 < 0 && d3 * d4 < 0
}

const NORMALS: Record<Side, [number, number]> = {
  south: [0, -1],
  east: [1, 0],
  north: [0, 1],
  west: [-1, 0],
}

/**
 * A quay `share` of the way along a side, from its south or west end, or as near there as it
 * keeps 2 u from every stretch `taken` (a canal's mouth, where a cascade pours into a pool; a
 * bridge's deck; another quay), without leaving the side.
 */
export function quayAt(
  shape: IslandShape,
  island: number,
  side: Side,
  share: number,
  port: boolean,
  plateaux: readonly Rect[],
  taken: readonly [number, number][] = [],
): Quay {
  const { plateau } = shape.island
  const vertical = side === 'east' || side === 'west'
  const start = vertical ? plateau.y : plateau.x
  const length = vertical ? plateau.height : plateau.width
  const size = port ? PORT_QUAY : PIER
  const half = size.width / 2
  const lowest = start + half
  const highest = start + length - half
  const wanted = Math.min(Math.max(start + share * length, lowest), highest)
  // How far the quay stands from the nearest taken stretch: free from 2 u on.
  const room = (at: number) =>
    taken.reduce(
      (least, [t0, t1]) => Math.min(least, Math.max(t0 - (at + half), at - half - t1)),
      Number.POSITIVE_INFINITY,
    )
  // The nearest free position; on a side with none, the one with the most room.
  let along = wanted
  let best = room(wanted)
  const steps = Math.ceil((highest - lowest) / LANDING_STEP)
  for (let k = 1; k <= 2 * steps && best < LANDING_CLEARANCE; k++) {
    const at = wanted + Math.ceil(k / 2) * LANDING_STEP * (k % 2 === 0 ? 1 : -1)
    if (at < lowest - 1e-9 || at > highest + 1e-9) {
      continue
    }
    const space = room(at)
    if (space > best + 1e-9) {
      along = at
      best = space
    }
  }
  // `offsetsAt` measures counter-clockwise from the side's start: west and north run backward.
  const fromStart = side === 'west' || side === 'north' ? start + length - along : along - start
  const beach = shape.offsetsAt(side, fromStart).at(-1) ?? 0
  const [nx, ny] = NORMALS[side]
  const out = beach - QUAY_ROOT
  const edge = {
    south: plateau.y,
    north: plateau.y + plateau.height,
    west: plateau.x,
    east: plateau.x + plateau.width,
  }[side]
  // The water ahead, up to the next plateau facing this point of the side.
  let ahead = Number.POSITIVE_INFINITY
  plateaux.forEach((other, index) => {
    if (index === island) {
      return
    }
    const [o0, o1] = vertical ? [other.y, other.y + other.height] : [other.x, other.x + other.width]
    if (along < o0 || along > o1) {
      return
    }
    const gap = {
      west: plateau.x - (other.x + other.width),
      east: other.x - (plateau.x + plateau.width),
      south: plateau.y - (other.y + other.height),
      north: other.y - (plateau.y + plateau.height),
    }[side]
    if (gap > 0) {
      ahead = Math.min(ahead, gap)
    }
  })
  const reach = Math.min(size.length, Math.max(QUAY_MIN, ahead / 2 - MID_CHANNEL - beach))
  return {
    island,
    side,
    x: vertical ? edge + nx * out : along,
    y: vertical ? along : edge + ny * out,
    nx,
    ny,
    length: QUAY_ROOT + reach,
    width: size.width,
    port,
  }
}

/**
 * A pier for a line shown for a while only: on the side of `island` that turns toward `toward`,
 * clear of its canals' mouths, bridges and quays. Nothing is built there.
 */
export function passingPier(
  layout: CityLayout,
  shapes: readonly IslandShape[],
  links: Pick<CityLinks, 'bridges' | 'quays'>,
  island: number,
  toward: number,
): Quay | null {
  const shape = shapes[island]
  if (!shape) {
    return null
  }
  const plateaux = layout.islands.map((each) => each.plateau)
  const side = sideToward(plateaux, island, toward)
  const taken = [
    ...mouthsOn(shape, side),
    ...decksOn(links.bridges, island, side),
    ...links.quays
      .filter((quay) => quay.island === island && quay.side === side)
      .map((quay) => quayStretch(quay)),
  ]
  return quayAt(shape, island, side, 0.5, false, plateaux, taken)
}

/** The end of a quay, out on the water. */
export function tipOf(quay: Quay): Point {
  return { x: quay.x + quay.nx * quay.length, y: quay.y + quay.ny * quay.length }
}

/** A small city's quay: on its largest island, on the side that looks out to the open sea. */
function loneQuay(
  layout: CityLayout,
  shapes: readonly IslandShape[],
  bridges: readonly Bridge[],
): Quay | null {
  let largest = 0
  layout.islands.forEach((island, index) => {
    const best = layout.islands[largest]?.plateau
    if (best && island.plateau.width * island.plateau.height > best.width * best.height) {
      largest = index
    }
  })
  const shape = shapes[largest]
  if (!shape) {
    return null
  }
  const side = openSide(
    layout.islands.map((island) => island.plateau),
    largest,
  )
  return quayAt(
    shape,
    largest,
    side,
    0.5,
    false,
    layout.islands.map((island) => island.plateau),
    [...mouthsOn(shape, side), ...decksOn(bridges, largest, side)],
  )
}

/** Two boats moored at every quay, and along each ferry line one per order of magnitude. */
function boats(links: CityLinks, layout: CityLayout): Boat[] {
  const boats: Boat[] = []
  for (const quay of links.quays) {
    if (quay.length - QUAY_ROOT < MOORING_MIN) {
      continue
    }
    const random = seededRandom(
      `boat/${layout.islands[quay.island]?.path ?? ''}/${quay.side}/${quay.x},${quay.y}`,
    )
    const out = quay.length - MOORING.out
    for (const across of [-1, 1]) {
      const offset = across * (quay.width / 2 + MOORING.across)
      boats.push({
        x: quay.x + quay.nx * out - quay.ny * offset,
        y: quay.y + quay.ny * out + quay.nx * offset,
        angle: Math.atan2(quay.ny, quay.nx) + (random() - 0.5) * 0.2,
        seed: random(),
      })
    }
  }
  links.ferries.forEach((ferry, index) => {
    const random = seededRandom(
      `boat/${layout.islands[ferry.a]?.path ?? ''}/${layout.islands[ferry.b]?.path ?? ''}`,
    )
    const count = boatsFor(ferry.imports)
    for (let k = 0; k < count; k++) {
      const share = (k + 1) / (count + 1)
      const { point, heading } = pointAlong(ferry.path, share)
      boats.push({
        x: point.x,
        y: point.y,
        angle: heading,
        seed: random(),
        line: { ferry: index, share },
      })
    }
  })
  return boats
}

/** The point `share` of the way along a line, and the line's heading there. */
export function pointAlong(
  line: readonly Point[],
  share: number,
): { point: Point; heading: number } {
  let total = 0
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1] as Point
    const b = line[i] as Point
    total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  let left = share * total
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1] as Point
    const b = line[i] as Point
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (left <= length || i === line.length - 1) {
      const t = length > 0 ? Math.min(left / length, 1) : 0
      return {
        point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        heading: Math.atan2(b.y - a.y, b.x - a.x),
      }
    }
    left -= length
  }
  return { point: line[0] ?? { x: 0, y: 0 }, heading: 0 }
}
