// Where the labels of the units the guide shows stand: each straight over its anchor, like a
// pin, its leader as long as the others; one that would cover a label placed before it rises
// over it, and never goes aside or below.

/** A box on the canvas, in CSS pixels. */
export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** A label to place: its anchor on the canvas and its size. */
export interface UnitLabelCandidate {
  x: number
  y: number
  width: number
  height: number
}

/** A label stands this many CSS pixels over its anchor, */
export const LABEL_LIFT = 24
/** keeping this far from other labels, */
const GAP = 6
/** and rises this many times at most: past them, it stands where it last tried. */
const MAX_RISES = 8

/**
 * Where each label's box stands, its top left corner, in the order given (the largest unit
 * first, which keeps the shortest leader).
 */
export function placeUnitLabels(
  candidates: readonly UnitLabelCandidate[],
  canvas: { width: number; height: number },
): { x: number; y: number }[] {
  const placed: Box[] = []
  return candidates.map((label) => {
    const x = Math.min(Math.max(label.x - label.width / 2, 0), canvas.width - label.width)
    const { width, height } = label
    let box: Box = { x, y: label.y - LABEL_LIFT - height, width, height }
    for (let rise = 0; rise < MAX_RISES; rise++) {
      const covered = placed.filter((other) => overlap(box, other))
      if (covered.length === 0) {
        break
      }
      box = { ...box, y: Math.min(...covered.map((other) => other.y)) - GAP - height }
    }
    placed.push(box)
    return { x: box.x, y: box.y }
  })
}

/** Whether two boxes come closer than `GAP`. */
function overlap(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width + GAP &&
    b.x < a.x + a.width + GAP &&
    a.y < b.y + b.height + GAP &&
    b.y < a.y + a.height + GAP
  )
}
