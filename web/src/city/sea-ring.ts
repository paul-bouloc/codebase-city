import type { Point, Rect } from './layout'

// Ferries sail around the archipelago on a ring of open sea: a rectangle with rounded corners
// past every shore. Each ferry has a lane of its own, one ring further out, so that lines never
// run over one another.

/** A rounded rectangle, measured counter-clockwise from the west end of its south side. */
export interface Ring {
  rect: Rect
  radius: number
  length: number
  pieces: Piece[]
}

type Piece =
  | { kind: 'side'; from: Point; to: Point; length: number }
  | { kind: 'corner'; cx: number; cy: number; start: number; length: number }

/** A ring around `rect`, `radius` at its corners (at most half its shorter side). */
export function ring(rect: Rect, radius: number): Ring {
  const r = Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2))
  const length = 2 * (rect.width - 2 * r) + 2 * (rect.height - 2 * r) + 2 * Math.PI * r
  return { rect, radius: r, length, pieces: pieces(rect, r) }
}

/** The pieces of a ring in order: four sides, each followed by the corner it turns at. */
function pieces(rect: Rect, r: number): Piece[] {
  const x0 = rect.x
  const y0 = rect.y
  const x1 = rect.x + rect.width
  const y1 = rect.y + rect.height
  const side = (from: Point, to: Point) => ({
    kind: 'side' as const,
    from,
    to,
    length: Math.hypot(to.x - from.x, to.y - from.y),
  })
  const corner = (cx: number, cy: number, start: number) => ({
    kind: 'corner' as const,
    cx,
    cy,
    start,
    length: (Math.PI / 2) * r,
  })
  return [
    side({ x: x0 + r, y: y0 }, { x: x1 - r, y: y0 }),
    corner(x1 - r, y0 + r, -Math.PI / 2),
    side({ x: x1, y: y0 + r }, { x: x1, y: y1 - r }),
    corner(x1 - r, y1 - r, 0),
    side({ x: x1 - r, y: y1 }, { x: x0 + r, y: y1 }),
    corner(x0 + r, y1 - r, Math.PI / 2),
    side({ x: x0, y: y1 - r }, { x: x0, y: y0 + r }),
    corner(x0 + r, y0 + r, Math.PI),
  ]
}

/** The point `s` u along a ring, any `s`. */
export function ringPoint(ring: Ring, s: number): Point {
  let left = ((s % ring.length) + ring.length) % ring.length
  for (const piece of ring.pieces) {
    if (left <= piece.length || piece.length === 0) {
      if (piece.length === 0) {
        continue
      }
      const t = left / piece.length
      if (piece.kind === 'side') {
        return {
          x: piece.from.x + (piece.to.x - piece.from.x) * t,
          y: piece.from.y + (piece.to.y - piece.from.y) * t,
        }
      }
      const angle = piece.start + (Math.PI / 2) * t
      return {
        x: piece.cx + ring.radius * Math.cos(angle),
        y: piece.cy + ring.radius * Math.sin(angle),
      }
    }
    left -= piece.length
  }
  return ringPoint(ring, 0)
}

/** Where along a ring its point nearest `point` stands, to a tenth of a unit. */
export function ringParam(ring: Ring, point: Point): number {
  const nearest = (from: number, to: number, step: number) => {
    let best = from
    let bestDistance = Number.POSITIVE_INFINITY
    for (let s = from; s <= to; s += step) {
      const p = ringPoint(ring, s)
      const distance = Math.hypot(p.x - point.x, p.y - point.y)
      if (distance < bestDistance) {
        best = s
        bestDistance = distance
      }
    }
    return best
  }
  const coarse = nearest(0, ring.length, 1)
  const fine = nearest(coarse - 1, coarse + 1, 0.1)
  return ((fine % ring.length) + ring.length) % ring.length
}

/** Where along a ring the middle of its west or east side stands. */
export function sideMiddle(ring: Ring, side: 'west' | 'east'): number {
  const { rect, radius: r } = ring
  const south = rect.width - 2 * r
  const corner = (Math.PI / 2) * r
  const height = rect.height - 2 * r
  const east = south + corner + height / 2
  return side === 'east' ? east : east + height / 2 + corner + south + corner + height / 2
}

/** The points of a ring from `from` to `to`, forward (counter-clockwise) or back, `step` apart. */
export function ringArc(
  ring: Ring,
  from: number,
  to: number,
  forward: boolean,
  step: number,
): Point[] {
  const span = arcLength(ring, from, to, forward)
  const count = Math.max(1, Math.ceil(span / step))
  return Array.from({ length: count + 1 }, (_, k) =>
    ringPoint(ring, from + (forward ? 1 : -1) * ((span * k) / count)),
  )
}

/** How far along a ring from `from` to `to`, forward or back. */
export function arcLength(ring: Ring, from: number, to: number, forward: boolean): number {
  const ahead = (((to - from) % ring.length) + ring.length) % ring.length
  return forward ? ahead : (ring.length - ahead) % ring.length
}

/** Whether going from `from` to `to` (forward or back) passes `through`. */
export function arcPasses(
  ring: Ring,
  from: number,
  to: number,
  forward: boolean,
  through: number,
): boolean {
  return arcLength(ring, from, through, forward) <= arcLength(ring, from, to, forward)
}
