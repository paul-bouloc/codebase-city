import { type Length, type Part, type Point, plus, times, ZERO } from './parts'
import { concreteBlock } from './shapes/concrete-block'
import { house } from './shapes/house'
import { pavilion } from './shapes/pavilion'
import { onSide, SIDES } from './shapes/sizing'
import type { VariantArchetype } from './variants-kit'

// The low buildings, assembled from the pieces their file drew, as the design's generator does.
// Board coordinates: x along the front, y in depth with the front towards y+, z up. Every
// combination is centred on its footprint, extras included.

const SHAPES: Record<VariantArchetype, (pieces: readonly string[]) => Part[]> = {
  house,
  pavilion,
  concreteBlock,
}

/**
 * The parts of a combination, centred on its footprint: the bounds on each side come from the
 * corner farthest out at the archetype's smallest and largest sides.
 */
export function variantParts(archetype: VariantArchetype, pieces: readonly string[]): Part[] {
  const parts = SHAPES[archetype](pieces)
  const points = parts.flatMap(({ faces }) => faces.flatMap((face) => face.points))
  const [small, large] = SIDES[archetype]
  const extreme = (axis: 0 | 1, sign: 1 | -1): Length => {
    const at = (side: number) => (point: Point) => sign * onSide(point[axis], side)
    const best = (side: number) =>
      points.reduce((farthest, point) => (at(side)(point) > at(side)(farthest) ? point : farthest))
    const [first] = points
    if (!first) {
      return ZERO
    }
    const [atSmall, atLarge] = [best(small), best(large)]
    // The same corner at both ends is the farthest all along: lengths are straight in the side
    return atSmall === atLarge ? atSmall[axis] : best((small + large) / 2)[axis]
  }
  const shift: [Length, Length] = [
    times(plus(extreme(0, 1), extreme(0, -1)), -0.5),
    times(plus(extreme(1, 1), extreme(1, -1)), -0.5),
  ]
  const move = ([x, y, z]: Point): Point => [plus(x, shift[0]), plus(y, shift[1]), z]
  return parts.map(({ faces, centre }) => ({
    centre: move(centre),
    faces: faces.map(({ stampCentre, ...face }) => ({
      ...face,
      points: face.points.map(move),
      ...(stampCentre
        ? { stampCentre: [plus(stampCentre[0], shift[0]), plus(stampCentre[1], shift[1])] as const }
        : {}),
    })),
  }))
}
