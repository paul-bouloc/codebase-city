import type { CityLayout, Point } from '../world/layout'
import { seededRandom } from '../world/random'
import type { Boat, CityLinks } from './links'
import { QUAY_ROOT } from './quays'

// Boats moor two by two at the quays, and sail the ferry lines: more on the busier ones.

/** Boats moored on each side of a quay, this far from its axis, this far out. */
const MOORING = { across: 0.85, out: 1.5 }
/** Boats moor only at a quay that reaches this far past the beach. */
const MOORING_MIN = 2

/** Boats along a ferry line: one per order of magnitude of its imports. */
export function boatsFor(imports: number): number {
  return Math.max(1, Math.floor(Math.log10(Math.max(imports, 1))) + 1)
}

/** Two boats moored at every quay, and along each ferry line one per order of magnitude. */
export function boats(links: CityLinks, layout: CityLayout): Boat[] {
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
