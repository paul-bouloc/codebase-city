import {
  cuboid,
  type Face,
  fitSide,
  HEIGHT,
  type Length,
  length,
  middle,
  minus,
  type Paint,
  type Part,
  type Point,
  part,
  plus,
  ROOF,
  SIDE,
  TRIM,
  times,
  toward,
  WALL,
  WHITE,
  ZERO,
} from './parts'
import { concreteBlock } from './shapes/concrete-block'
import { pavilion } from './shapes/pavilion'
import { onSide, SIDES, size } from './shapes/sizing'
import { HOUSE_EAVE, KIT, type VariantArchetype } from './variants-kit'

// The low buildings, assembled from the pieces their file drew, as the design's generator does.
// Board coordinates: x along the front, y in depth with the front towards y+, z up. Every
// combination is centred on its footprint, extras included.

const light: Paint = { colour: WHITE, amount: 0.75 }
const brick = toward(ROOF, '#5A4A40', 0.45)
const brickTop = toward(brick, '#000000', 0.1)
const POINT_UP = length(1)

/** One face seen from both sides: two parts, each turned away from its own centre. */
function twoSided(points: Point[], paint: Paint): Part[] {
  const [first] = points
  if (!first) {
    return []
  }
  return [-1, 1].map((below) => ({
    faces: [{ paint, points }],
    centre: [first[0], first[1], plus(first[2], times(POINT_UP, below))],
  }))
}

interface Volume {
  x0: Length
  x1: Length
  y0: Length
  y1: Length
}

function house(pieces: readonly string[]): Part[] {
  const has = (id: string) => pieces.includes(id)
  const e = length(HOUSE_EAVE)
  const H = HEIGHT
  const parts: Part[] = []
  const annex = has('ax')
  const lShaped = has('L')

  let main: Volume
  let wing: Volume | undefined
  if (lShaped) {
    const l = size('house', 'L', 'main length')
    const d = size('house', 'L', 'main depth')
    const wingLength = size('house', 'L', 'wing length')
    const total = plus(d, size('house', 'L', 'wing depth'))
    const y0 = times(total, -0.5)
    main = { x0: times(l, -0.5), x1: times(l, 0.5), y0, y1: plus(y0, d) }
    // The wing comes forward from the main volume's right end
    wing = { x0: minus(main.x1, wingLength), x1: main.x1, y0: main.y1, y1: times(total, 0.5) }
  } else {
    const l = size('house', 'S', annex ? 'length with annex' : 'length')
    const d = size('house', 'S', 'depth')
    const total = annex ? plus(l, size('house', 'ax', 'length')) : l
    const x0 = times(total, -0.5)
    main = { x0, x1: plus(x0, l), y0: times(d, -0.5), y1: times(d, 0.5) }
  }
  const corners = (v: Volume) => [v.x0, v.y0, v.x1, v.y1] as const
  parts.push(cuboid(corners(main), ZERO, H, WALL, ROOF, { omit: ['top'] }))
  if (wing) {
    parts.push(cuboid(corners(wing), ZERO, H, WALL, ROOF, { omit: ['top', 'y-'] }))
  }

  const depth = minus(main.y1, main.y0)
  const roof = has('H') ? 'H' : has('P') ? 'P' : 'G'
  const rise = size('house', roof, 'rise', depth)
  const ridge = plus(H, rise)
  // The roof's outline, eaves included
  const rx0 = minus(main.x0, e)
  const rx1 = plus(main.x1, e)
  const ry0 = minus(main.y0, e)
  const ry1 = plus(main.y1, e)
  const ym = middle(main.y0, main.y1)
  if (roof === 'G') {
    parts.push(
      part([
        {
          paint: ROOF,
          points: [
            [rx0, ry0, H],
            [rx1, ry0, H],
            [rx1, ym, ridge],
            [rx0, ym, ridge],
          ],
        },
        {
          paint: ROOF,
          stamp: true,
          points: [
            [rx1, ry1, H],
            [rx0, ry1, H],
            [rx0, ym, ridge],
            [rx1, ym, ridge],
          ],
        },
        {
          paint: WALL,
          points: [
            [rx1, ry0, H],
            [rx1, ry1, H],
            [rx1, ym, ridge],
          ],
        },
        {
          paint: WALL,
          points: [
            [rx0, ry1, H],
            [rx0, ry0, H],
            [rx0, ym, ridge],
          ],
        },
      ]),
    )
  } else if (roof === 'H') {
    // The ridge is as much shorter than the roof as the roof is deep
    const xc = middle(rx0, rx1)
    const half = times(minus(minus(rx1, rx0), minus(ry1, ry0)), 0.5)
    const a: Point = [minus(xc, half), ym, ridge]
    const b: Point = [plus(xc, half), ym, ridge]
    parts.push(
      part([
        { paint: ROOF, points: [[rx0, ry0, H], [rx1, ry0, H], b, a] },
        { paint: ROOF, stamp: true, points: [[rx1, ry1, H], [rx0, ry1, H], a, b] },
        { paint: ROOF, points: [[rx1, ry0, H], [rx1, ry1, H], b] },
        { paint: ROOF, points: [[rx0, ry1, H], [rx0, ry0, H], a] },
      ]),
    )
  } else {
    // A shed: high at the back, the back wall rising to it
    parts.push(
      part([
        {
          paint: ROOF,
          stamp: true,
          points: [
            [rx0, ry0, ridge],
            [rx1, ry0, ridge],
            [rx1, ry1, H],
            [rx0, ry1, H],
          ],
        },
        {
          paint: WALL,
          points: [
            [main.x0, main.y0, H],
            [main.x1, main.y0, H],
            [main.x1, main.y0, ridge],
            [main.x0, main.y0, ridge],
          ],
        },
        {
          paint: WALL,
          points: [
            [main.x1, main.y0, H],
            [main.x1, main.y1, H],
            [main.x1, main.y0, ridge],
          ],
        },
        {
          paint: WALL,
          points: [
            [main.x0, main.y1, H],
            [main.x0, main.y0, H],
            [main.x0, main.y0, ridge],
          ],
        },
      ]),
    )
  }

  if (wing) {
    // The wing's gable roof runs front to back, from the middle of the main roof
    const width = minus(wing.x1, wing.x0)
    const wingRise = size('house', 'G', 'rise', width)
    const x0 = minus(wing.x0, e)
    const x1 = plus(wing.x1, e)
    const y0 = minus(main.y1, times(width, 0.5))
    const y1 = plus(wing.y1, e)
    const xm = middle(x0, x1)
    const top = plus(H, wingRise)
    parts.push(
      part([
        {
          paint: ROOF,
          points: [
            [x0, y0, H],
            [x0, y1, H],
            [xm, y1, top],
            [xm, y0, top],
          ],
        },
        {
          paint: ROOF,
          points: [
            [x1, y1, H],
            [x1, y0, H],
            [xm, y0, top],
            [xm, y1, top],
          ],
        },
        {
          paint: WALL,
          points: [
            [x0, y1, H],
            [x1, y1, H],
            [xm, y1, top],
          ],
        },
        {
          paint: WALL,
          points: [
            [x1, y0, H],
            [x0, y0, H],
            [xm, y0, top],
          ],
        },
      ]),
    )
  }

  const mainLength = minus(main.x1, main.x0)
  const centreX = plus(main.x0, times(mainLength, 0.5))
  if (has('ch')) {
    const width = size('house', 'ch', 'width')
    const cx = plus(centreX, size('house', 'ch', 'offset along ridge'))
    const cy =
      roof === 'P'
        ? plus(main.y0, length(0.22))
        : plus(ym, size('house', 'ch', 'offset across ridge'))
    const half = times(width, 0.5)
    parts.push(
      cuboid(
        [minus(cx, half), minus(cy, half), plus(cx, half), plus(cy, half)],
        H,
        plus(ridge, size('house', 'ch', 'above ridge')),
        brick,
        brickTop,
      ),
    )
  }

  if (has('dm')) {
    parts.push(dormer(roof, centreX))
  }

  const front = main.y1
  if (has('cn')) {
    const width = size('house', 'cn', 'width')
    const z = size('house', 'cn', 'height')
    const cx = wing
      ? plus(plus(main.x0, times(minus(wing.x0, main.x0), 0.3)), times(width, 0.5))
      : plus(centreX, size('house', 'cn', 'offset along wall'))
    const half = times(width, 0.5)
    const out = plus(front, size('house', 'cn', 'depth'))
    const low = minus(z, length(0.04))
    parts.push(
      ...twoSided(
        [
          [minus(cx, half), front, z],
          [plus(cx, half), front, z],
          [plus(cx, half), out, low],
          [minus(cx, half), out, low],
        ],
        ROOF,
      ),
    )
  }

  if (has('vr')) {
    const half = times(size('house', 'vr', 'length'), 0.5)
    const cx = plus(centreX, size('house', 'vr', 'offset along wall'))
    parts.push(
      cuboid(
        [minus(cx, half), front, plus(cx, half), plus(front, size('house', 'vr', 'depth'))],
        ZERO,
        size('house', 'vr', 'height'),
        light,
        TRIM,
        { omit: ['y-'] },
      ),
    )
  }

  if (annex) {
    const x0 = main.x1
    const x1 = plus(x0, size('house', 'ax', 'length'))
    const y0 = main.y0
    const y1 = plus(y0, size('house', 'ax', 'depth', depth))
    const high = size('house', 'ax', 'height at house')
    const low = size('house', 'ax', 'height outside')
    parts.push(
      part([
        {
          paint: ROOF,
          points: [
            [x0, y0, high],
            [x1, y0, low],
            [x1, y1, low],
            [x0, y1, high],
          ],
        },
        {
          paint: WALL,
          points: [
            [x1, y0, ZERO],
            [x1, y1, ZERO],
            [x1, y1, low],
            [x1, y0, low],
          ],
        },
        {
          paint: WALL,
          points: [
            [x1, y1, ZERO],
            [x0, y1, ZERO],
            [x0, y1, high],
            [x1, y1, low],
          ],
        },
        {
          paint: WALL,
          points: [
            [x0, y0, ZERO],
            [x1, y0, ZERO],
            [x1, y0, low],
            [x0, y0, high],
          ],
        },
      ]),
    )
  }
  return parts
}

/**
 * A dormer on the front slope of a simple house's roof: only on one floor and from the side
 * its rule sets, so its heights are fitted on those sides.
 */
function dormer(roof: string, centreX: Length): Part {
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
