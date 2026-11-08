import {
  type Face,
  fitSide,
  HEIGHT,
  type Length,
  length,
  minus,
  type Part,
  part,
  plus,
  ROOF,
  SIDE,
  TRIM,
  times,
  WALL,
} from '../parts'
import { HOUSE_EAVE, KIT } from '../variants-kit'
import { onSide, SIDES, size } from './sizing'

/**
 * A dormer on the front slope of a simple house's roof: only on one floor and from the side
 * its rule sets, so its heights are fitted on those sides.
 */
export function dormer(roof: string, centreX: Length): Part {
  const e = HOUSE_EAVE
  // The simple body's depth per u of side, the roof's rise per u of depth: both from the kit
  const DEPTH = onSide(size('house', 'S', 'depth'), 1)
  const rise = onSide(size('house', roof, 'rise', SIDE), 1)
  const setBack = onSide(size('house', 'dm', 'set back from wall'), 0)
  // The front slope's height above the walls, at a distance from the middle of the roof
  const slope = (side: number) => {
    const depth = DEPTH * side
    return { depth, high: rise * depth, run: depth / 2 + e }
  }
  const foot = (side: number) => {
    const { depth, high, run } = slope(side)
    return high * (1 - (depth / 2 - setBack) / run)
  }
  const head = (side: number) => {
    const { high } = slope(side)
    return foot(side) + 0.55 * (high - foot(side))
  }
  const back = (side: number) => {
    const { high, run } = slope(side)
    return run * (1 - head(side) / high)
  }
  const smallest = KIT.house.pieces.find(({ id }) => id === 'dm')?.rule.sMin ?? SIDES.house[0]
  const [from, to] = [smallest, SIDES.house[1]]
  const zf = plus(HEIGHT, fitSide(foot, from, to))
  const zt = plus(HEIGHT, fitSide(head, from, to))
  const yb = fitSide(back, from, to)
  const yf = minus(times(SIDE, DEPTH / 2), length(setBack))
  const half = times(size('house', 'dm', 'width'), 0.5)
  const xc = plus(centreX, size('house', 'dm', 'offset along ridge'))
  const a = minus(xc, half)
  const b = plus(xc, half)
  const capRise = plus(zt, size('house', 'dm', 'cap rise'))
  const capA = minus(a, length(0.02))
  const capB = plus(b, length(0.02))
  const capFront = plus(yf, length(0.03))
  const faces: Face[] = [
    {
      paint: WALL,
      points: [
        [a, yf, zf],
        [b, yf, zf],
        [b, yf, zt],
        [a, yf, zt],
      ],
    },
    {
      paint: WALL,
      points: [
        [a, yb, zt],
        [a, yf, zf],
        [a, yf, zt],
      ],
    },
    {
      paint: WALL,
      points: [
        [b, yf, zf],
        [b, yb, zt],
        [b, yf, zt],
      ],
    },
    {
      paint: ROOF,
      points: [
        [capA, capFront, zt],
        [capA, yb, zt],
        [xc, yb, capRise],
        [xc, capFront, capRise],
      ],
    },
    {
      paint: ROOF,
      points: [
        [capB, yb, zt],
        [capB, capFront, zt],
        [xc, capFront, capRise],
        [xc, yb, capRise],
      ],
    },
    {
      paint: TRIM,
      points: [
        [capA, capFront, zt],
        [capB, capFront, zt],
        [xc, capFront, capRise],
      ],
    },
  ]
  return part(faces)
}
