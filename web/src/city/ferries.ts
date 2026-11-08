import { Group } from 'three'
import type { Ferry } from './links'
import { FERRY_LINE, UPWARD } from './palette'
import { createScreenLines } from './screen-lines'
import { boardToThree, srgb } from './units'

// A ferry line is a route drawn on the sea, as on a chart: as wide on screen at any distance,
// its dashes painted along it in the scene's perspective, filling in from afar. Every line looks
// the same, whatever it carries; a link that goes up the layers is red.

/** Just above the sea and the foam (0.02 u). */
const ALTITUDE = 0.04
/** Width in CSS pixels; dash and gap along the line, in u. */
const WIDTH = 2
const DASH: [number, number] = [1.2, 0.9]
const OPACITY = 0.9

/** Every ferry line: one mesh for those that go down, one for those that go up. */
export function createFerries(ferries: readonly Ferry[], pixelRatio: number): Group {
  const group = new Group()
  for (const upward of [false, true]) {
    const lines = ferries
      .filter((ferry) => ferry.upward === upward && ferry.path.length >= 2)
      .map((ferry) => ferry.path.map(({ x, y }) => boardToThree(x, y, ALTITUDE)))
    if (lines.length > 0) {
      const colour = srgb(upward ? UPWARD : FERRY_LINE)
      group.add(
        createScreenLines(
          lines,
          { width: WIDTH, colour, sceneDash: DASH, opacity: OPACITY },
          pixelRatio,
          false,
        ),
      )
    }
  }
  return group
}
