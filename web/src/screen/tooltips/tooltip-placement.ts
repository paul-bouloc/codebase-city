export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Rect extends Point, Size {}

// Distance from the pointer, and the margin kept inside the screen.
export const POINTER_OFFSET = 24
export const SCREEN_MARGIN = 16

// Top left corner of a tooltip: 24 px right of the pointer and below it by default. It flips
// left, then above, then both, to stay 16 px inside the screen and off the open panels. When no
// side fits, the default side is pushed back inside the screen.
export function placeTooltip(
  pointer: Point,
  size: Size,
  viewport: Size,
  obstacles: readonly Rect[] = [],
): Point {
  const right = pointer.x + POINTER_OFFSET
  const left = pointer.x - POINTER_OFFSET - size.width
  const below = pointer.y
  const above = pointer.y - size.height
  const candidates: Point[] = [
    { x: right, y: below },
    { x: left, y: below },
    { x: right, y: above },
    { x: left, y: above },
  ]

  const fits = ({ x, y }: Point) =>
    x >= SCREEN_MARGIN &&
    y >= SCREEN_MARGIN &&
    x + size.width <= viewport.width - SCREEN_MARGIN &&
    y + size.height <= viewport.height - SCREEN_MARGIN &&
    obstacles.every((obstacle) => !overlaps({ x, y, ...size }, obstacle))

  const found = candidates.find(fits)
  if (found) {
    return found
  }
  return {
    x: clamp(right, SCREEN_MARGIN, viewport.width - SCREEN_MARGIN - size.width),
    y: clamp(below, SCREEN_MARGIN, viewport.height - SCREEN_MARGIN - size.height),
  }
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

// A tooltip larger than the screen keeps its top left corner on the margin.
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}
