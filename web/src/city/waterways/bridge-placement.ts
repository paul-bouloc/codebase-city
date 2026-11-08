import type { IslandShape, Side } from '../terrain/island-shape'
import type { CityLayout, Point, Rect } from '../world/layout'
import { layerAltitude } from '../world/units'
import { LANDING_CLEARANCE, LANDING_STEP, mouthsOn } from './island-sides'
import type { Bridge, Pair } from './links'
import { insidePolygon } from './water-grid'

// Two neighbours face to face across one channel get a bridge, landed near the middle of the
// folders that face each other, clear of canals' mouths and of any third island's land.

/** A bridge spans a channel this wide at most: the layout's widest. */
const MAX_CHANNEL = 24
/** Room kept between a deck and a third island's land. */
const DECK_CLEARANCE = 0.5

/** Width of a bridge's deck, in u, from the imports it carries. */
export function deckWidth(imports: number): number {
  return Math.min(4.6, 0.6 + 0.9 * Math.log10(imports + 1))
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
export function bridgeFor(
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
