/** A CSS `cubic-bezier(x1, y1, x2, y2)` timing function, for time from 0 to 1. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  // Each coordinate of the curve, a cubic in s through 0 and 1.
  const at = (a: number, b: number, s: number) =>
    3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3
  return (t) => {
    if (t <= 0) {
      return 0
    }
    if (t >= 1) {
      return 1
    }
    // x grows with s: find the s whose x is t by halving.
    let low = 0
    let high = 1
    for (let step = 0; step < 30; step++) {
      const s = (low + high) / 2
      if (at(x1, x2, s) < t) {
        low = s
      } else {
        high = s
      }
    }
    return at(y1, y2, (low + high) / 2)
  }
}

/** The interface's standard easing. */
export const easeStandard = cubicBezier(0.2, 0, 0, 1)
