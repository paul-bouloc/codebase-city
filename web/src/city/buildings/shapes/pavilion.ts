import { mixSrgb, srgb } from '../../world/units'
import {
  cuboid,
  FLOOR_SIDES,
  FLOOR_TOP,
  fitSide,
  fixedPaint,
  HEIGHT,
  type Length,
  minus,
  type Paint,
  type Part,
  POST,
  type Point,
  part,
  plus,
  ROOF,
  ROOF_EDGE,
  SIDE,
  times,
  WALL,
  WOOD,
  ZERO,
} from '../parts'
import { onSide, SIDES, size } from './sizing'

const SCREEN = fixedPaint(mixSrgb(WOOD, '#FFFFFF', 0.12))
const BENCH = fixedPaint(srgb(WOOD))
const BENCH_END = fixedPaint(mixSrgb(WOOD, '#000000', 0.12))

export function pavilion(pieces: readonly string[]): Part[] {
  const has = (id: string) => pieces.includes(id)
  const parts: Part[] = []
  const h2 = times(SIDE, 0.5)
  const low = times(h2, -1)
  const floor = size('pavilion', 'D', 'thickness')
  const deckFront = has('T') ? plus(h2, size('pavilion', 'T', 'front extension')) : h2
  parts.push(cuboid([low, low, h2, deckFront], ZERO, floor, FLOOR_SIDES, FLOOR_TOP))

  // The roof slab: the height under it is the building's height; a shed roof lifts at the front
  const overhang = size('pavilion', 'F', 'overhang')
  const thickness = size('pavilion', 'F', 'thickness')
  const lift = has('M') ? onSide(size('pavilion', 'M', 'front lift'), 0) : 0
  const r0 = minus(low, overhang)
  const r1 = plus(h2, overhang)
  const ov = onSide(overhang, 0)
  /** The height under the roof at y, a fixed share of its depth: fitted on the pavilion's sides. */
  const under = (y: Length): Length =>
    plus(
      HEIGHT,
      fitSide(
        (side) => (lift * (onSide(y, side) + side / 2 + ov)) / (side + 2 * ov),
        ...SIDES.pavilion,
      ),
    )
  parts.push(
    cuboid(
      [r0, r0, r1, r1],
      [under(r0), under(r1)],
      [plus(under(r0), thickness), plus(under(r1), thickness)],
      ROOF_EDGE,
      ROOF,
      { stamp: true },
    ),
  )

  const thick = size('pavilion', 'BW', 'thickness')
  const inset = size('pavilion', 'BW', 'end inset')
  const postWidth = size('pavilion', 'post', 'width')
  const postInset = size('pavilion', 'post', 'inset')
  const frame = has('SW') ? 'SW' : has('CW') ? 'CW' : has('SC') ? 'SC' : 'BW'
  const wall = (x0: Length, y0: Length, x1: Length, y1: Length, paint: Paint) =>
    cuboid([x0, y0, x1, y1], floor, [under(y0), under(y1)], paint, paint, { omit: ['top'] })
  const back = plus(low, thick)
  if (frame !== 'SW') {
    parts.push(wall(plus(low, inset), low, minus(h2, inset), back, WALL))
  }
  if (frame === 'SW' || frame === 'CW') {
    parts.push(
      wall(low, frame === 'CW' ? back : plus(low, inset), plus(low, thick), minus(h2, inset), WALL),
    )
  }
  const near = plus(low, postInset)
  const far = minus(h2, postInset)
  const posts: [Length, Length][] = {
    BW: [
      [near, far],
      [far, far],
    ] as [Length, Length][],
    SW: [
      [far, near],
      [far, far],
    ] as [Length, Length][],
    CW: [[far, far]] as [Length, Length][],
    SC: [[near, far]] as [Length, Length][],
  }[frame]
  const halfPost = times(postWidth, 0.5)
  for (const [x, y] of posts) {
    parts.push(
      wall(minus(x, halfPost), minus(y, halfPost), plus(x, halfPost), plus(y, halfPost), POST),
    )
  }
  if (frame === 'SC') {
    const half = times(size('pavilion', 'SC', 'thickness'), 0.5)
    parts.push(
      wall(
        minus(far, half),
        minus(far, size('pavilion', 'SC', 'length')),
        plus(far, half),
        plus(far, half),
        SCREEN,
      ),
    )
  }

  if (has('bn')) {
    // A wedge of a bench against the closed side
    const half = times(size('pavilion', 'bn', 'length'), 0.5)
    const depth = size('pavilion', 'bn', 'depth')
    const seat = plus(floor, size('pavilion', 'bn', 'height'))
    const inner = plus(low, thick)
    const outer = plus(inner, depth)
    const neg = times(half, -1)
    const at = (across: Length, along: Length, z: Length): Point =>
      frame === 'SW' ? [across, along, z] : [along, across, z]
    parts.push(
      part([
        {
          paint: BENCH,
          points: [
            at(inner, neg, seat),
            at(inner, half, seat),
            at(outer, half, floor),
            at(outer, neg, floor),
          ],
        },
        {
          paint: BENCH_END,
          points: [at(inner, neg, floor), at(inner, neg, seat), at(outer, neg, floor)],
        },
        {
          paint: BENCH_END,
          points: [at(inner, half, seat), at(inner, half, floor), at(outer, half, floor)],
        },
      ]),
    )
  }
  return parts
}
