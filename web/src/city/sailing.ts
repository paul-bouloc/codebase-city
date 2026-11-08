import type { Point } from './layout'

// A boat on a ferry line sails from one pier to the other and back, slowing down at each end: its
// way along the line follows a half cosine, so that it eases out of a pier and into the next.

/** Average speed along a line, in u per second. */
export const SAIL_SPEED = 2.5

/** Where a boat is and where it heads, on the board. */
export interface Sail {
  x: number
  y: number
  /** In radians from the east, counter-clockwise. */
  angle: number
}

/** A line, measured once: the distance to each of its points. */
export class Route {
  private readonly distances: number[] = [0]
  readonly length: number

  constructor(private readonly path: readonly Point[]) {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1] as Point
      const b = path[i] as Point
      this.distances.push((this.distances[i - 1] as number) + Math.hypot(b.x - a.x, b.y - a.y))
    }
    this.length = this.distances.at(-1) ?? 0
  }

  /** The point this far along the line, and the line's heading there. */
  at(distance: number): Sail {
    const { path, distances } = this
    // The segment that holds the distance, by bisection.
    let low = 1
    let high = Math.max(path.length - 1, 1)
    while (low < high) {
      const middle = (low + high) >> 1
      if ((distances[middle] as number) < distance) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    const a = path[low - 1] ?? path[0] ?? { x: 0, y: 0 }
    const b = path[low] ?? a
    const from = distances[low - 1] ?? 0
    const span = (distances[low] ?? from) - from
    const t = span > 0 ? Math.min(Math.max((distance - from) / span, 0), 1) : 0
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    }
  }
}

/**
 * Where a boat that started `share` of the way along, heading for the line's end, is after this
 * many seconds.
 */
export function sail(route: Route, share: number, seconds: number, speed = SAIL_SPEED): Sail {
  if (route.length <= 0) {
    return route.at(0)
  }
  // A leg is one way, eased; the start is the leg's phase whose eased place is `share`.
  const start = Math.acos(1 - 2 * Math.min(Math.max(share, 0), 1)) / Math.PI
  const leg = route.length / speed
  const phase = (((start + seconds / leg) % 2) + 2) % 2
  const outward = phase < 1
  const progress = outward ? phase : 2 - phase
  const place = route.at(((1 - Math.cos(Math.PI * progress)) / 2) * route.length)
  return outward ? place : { ...place, angle: place.angle + Math.PI }
}
