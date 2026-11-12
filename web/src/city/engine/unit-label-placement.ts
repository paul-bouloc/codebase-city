// Where the labels of the units the guide shows stand: over their anchor, slid along a grid to
// clear the labels placed before them and the islands the step shows, the nearer the better.

/** A box on the canvas, in CSS pixels. */
export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** A label to place: its anchor on the canvas, its size, and where it stood if on show. */
export interface UnitLabelCandidate {
  x: number
  y: number
  width: number
  height: number
  /** Its box's top left corner from its anchor, as it stood; none if it was not on show. */
  previous: { x: number; y: number } | null
}

/** A label first tries to stand this many CSS pixels over its anchor. */
export const LABEL_LIFT = 23
/** It then slides by these steps, this many of them each way: */
const STEP = { across: 30, down: 12 }
const STEPS = { across: 7, up: 16, down: 8 }
/** keeping this far from other labels, */
const GAP = 6
/** this far inside the canvas, */
const EDGE = 4
/** an overlap with an island costing more than one with a label, */
const ISLAND_COST = 30
const LABEL_COST = 12
/** each pixel away costing this much, more going down, */
const DISTANCE_COST = 0.8
const DOWN_COST = 1.6
/** and a label on show keeps its place unless another is better by this much. */
const STAY = 60

/**
 * Where each label's box stands, its top left corner, in the order given (the largest unit
 * first): the best of the places tried, by how much it overlaps and how far it slid.
 */
export function placeUnitLabels(
  candidates: readonly UnitLabelCandidate[],
  islands: readonly Box[],
  canvas: { width: number; height: number },
): { x: number; y: number }[] {
  const placed: Box[] = []
  return candidates.map((label) => {
    const home = { x: label.x - label.width / 2, y: label.y - LABEL_LIFT - label.height }
    const clamp = (x: number, y: number): Box => ({
      x: Math.min(Math.max(x, EDGE), canvas.width - label.width - EDGE),
      y: Math.min(Math.max(y, EDGE), canvas.height - label.height - EDGE),
      width: label.width,
      height: label.height,
    })
    const cost = (box: Box) => {
      const down = Math.max(box.y - home.y, 0)
      const up = Math.min(box.y - home.y, 0)
      const away = Math.hypot(box.x - home.x, up, down * DOWN_COST)
      return overlaps(box, placed, islands) + away * DISTANCE_COST
    }
    let best = clamp(home.x, home.y)
    let bestCost = cost(best)
    for (let down = -STEPS.up; down <= STEPS.down; down += 1) {
      for (let across = -STEPS.across; across <= STEPS.across; across += 1) {
        const box = clamp(home.x + across * STEP.across, home.y + down * STEP.down)
        const boxCost = cost(box)
        if (boxCost < bestCost) {
          best = box
          bestCost = boxCost
        }
      }
    }
    if (label.previous) {
      const kept = clamp(label.x + label.previous.x, label.y + label.previous.y)
      if (cost(kept) <= bestCost + STAY) {
        best = kept
      }
    }
    placed.push(best)
    return { x: best.x, y: best.y }
  })
}

/** What a box's overlaps cost: with labels, `GAP` around them included, and with islands. */
function overlaps(box: Box, labels: readonly Box[], islands: readonly Box[]): number {
  let total = 0
  for (const other of labels) {
    total += overlap(box, other, GAP) * LABEL_COST
  }
  for (const island of islands) {
    total += overlap(box, island, 0) * ISLAND_COST
  }
  return total
}

function overlap(a: Box, b: Box, gap: number): number {
  const across = Math.min(a.x + a.width, b.x + b.width + gap) - Math.max(a.x, b.x - gap)
  const down = Math.min(a.y + a.height, b.y + b.height + gap) - Math.max(a.y, b.y - gap)
  return across > 0 && down > 0 ? across * down : 0
}
