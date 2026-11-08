// The sea chart's scale: how many files a bar of the screen spans at the camera's target.

/** The scale bar's width, in CSS pixels (MapScale). */
export const SCALE_BAR = 96

/**
 * About how many files a square as wide as the bar holds, at the city's mean density, rounded to
 * 1, 2 or 5 times a power of ten: a chart's scale reads at a glance, never to the file.
 */
export function scaleFiles(pixelsPerUnit: number, filesPerSquareUnit: number): number {
  if (!(pixelsPerUnit > 0) || !(filesPerSquareUnit > 0)) {
    return 1
  }
  const side = SCALE_BAR / pixelsPerUnit
  return roundForChart(side * side * filesPerSquareUnit)
}

/** The nearest of 1, 2, 5, 10, 20, 50… on a log scale; 1 at least. */
export function roundForChart(value: number): number {
  if (!(value > 1)) {
    return 1
  }
  const power = 10 ** Math.floor(Math.log10(value))
  const steps = [1, 2, 5, 10]
  let best = power
  for (const step of steps) {
    if (Math.abs(Math.log(value / (step * power))) < Math.abs(Math.log(value / best))) {
      best = step * power
    }
  }
  return best
}

/** A heading in degrees, clockwise from north, from camera-controls' azimuth in radians. */
export function bearingOf(azimuth: number): number {
  // At azimuth 0 the camera stands south of its target and looks north; it turns anticlockwise.
  const degrees = (-azimuth * 180) / Math.PI
  return ((Math.round(degrees) % 360) + 360) % 360
}

/** The azimuth nearest to `azimuth` that faces north: camera-controls never wraps its angle. */
export function northOf(azimuth: number): number {
  return Math.round(azimuth / (2 * Math.PI)) * 2 * Math.PI
}
