import type { Vec3 } from './units'

// The arc between two linked files: a parabola from roof to roof that rises higher the further
// apart they stand, so that long links clear the city and read apart from short ones.

/** The peak, above the higher end: `min(30 ; 2 + 0.28 × distance)` u. */
const PEAK_BASE = 2
const PEAK_PER_UNIT = 0.28
const PEAK_MAX = 30
export const ARC_SEGMENTS = 24

/** How far above the higher of its two ends an arc between them peaks, in u. */
export function arcRise(a: Vec3, b: Vec3): number {
  const across = Math.hypot(b[0] - a[0], b[2] - a[2])
  return Math.min(PEAK_MAX, PEAK_BASE + PEAK_PER_UNIT * across)
}

/**
 * The arc from `a` to `b`, in three.js coordinates (y up): `ARC_SEGMENTS + 1` points of a
 * quadratic curve whose middle point is the peak. `lean` bends it aside, as a share of the
 * distance between its ends, to the left of its way seen from above: the arcs of a loop between
 * two files part, one each way.
 */
export function arcPoints(a: Vec3, b: Vec3, segments = ARC_SEGMENTS, lean = 0): Vec3[] {
  const peak = Math.max(a[1], b[1]) + arcRise(a, b)
  // A quadratic Bézier passes its middle at a quarter of each end and half of its control, which
  // lies twice as far aside as the middle.
  const dx = b[0] - a[0]
  const dz = b[2] - a[2]
  const control: Vec3 = [
    (a[0] + b[0]) / 2 + 2 * lean * dz,
    2 * peak - (a[1] + b[1]) / 2,
    (a[2] + b[2]) / 2 - 2 * lean * dx,
  ]
  const points: Vec3[] = []
  for (let step = 0; step <= segments; step++) {
    const t = step / segments
    const u = 1 - t
    const point = [0, 1, 2].map(
      (axis) => u * u * (a[axis] ?? 0) + 2 * u * t * (control[axis] ?? 0) + t * t * (b[axis] ?? 0),
    ) as Vec3
    points.push(point)
  }
  return points
}
