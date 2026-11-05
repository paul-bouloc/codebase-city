import {
  CONCRETE_ROOF,
  CONCRETE_WALL,
  cuboid,
  type Face,
  FLOOR_SIDES,
  FLOOR_TOP,
  fitSide,
  fixedPaint,
  HEIGHT,
  INK,
  type Length,
  length,
  middle,
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
  TRIM,
  times,
  toward,
  WALL,
  WHITE,
  WOOD,
  ZERO,
} from './parts'
import { mixSrgb, srgb } from './units'
import { HOUSE_EAVE, KIT, type VariantArchetype } from './variants-kit'

// The low buildings, assembled from the pieces their file drew, as the design's generator does.
// Board coordinates: x along the front, y in depth with the front towards y+, z up. Every
// combination is centred on its footprint, extras included.

/** A size of the kit as a length; `depth` is that of the volume the piece sits on. */
function size(archetype: VariantArchetype, piece: string, name: string, depth = ZERO): Length {
  const value = KIT[archetype].pieces.find(({ id }) => id === piece)?.sizes[name]
  if (!value) {
    throw new Error(`The kit has no ${name} for ${archetype} ${piece}`)
  }
  return plus(length(value[0], value[1], value[2]), times(depth, value[3]))
}

/** The sides each archetype takes, so lengths the design defines by ratios fit them best. */
const SIDES: Record<VariantArchetype, readonly [number, number]> = {
  house: [0.75, 1.5],
  pavilion: [0.75, 1.54],
  concreteBlock: [0.75, 1.7],
}

/** The value of a length on the side `s`, without height: footprints never follow it. */
const onSide = (value: Length, side: number) => value[0] + value[1] * side

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
 * A dormer on the front slope of a simple house's roof: only on one floor and a side of 1.1 u
 * or more, so its heights are fitted on those sides.
 */
function dormer(roof: string, centreX: Length): Part {
  const e = HOUSE_EAVE
  const DEPTH = 0.74
  const rise = roof === 'H' ? 0.36 : 0.42
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
  const [from, to] = [1.1, SIDES.house[1]]
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

const SCREEN = fixedPaint(mixSrgb(WOOD, '#FFFFFF', 0.12))
const BENCH = fixedPaint(srgb(WOOD))
const BENCH_END = fixedPaint(mixSrgb(WOOD, '#000000', 0.12))

function pavilion(pieces: readonly string[]): Part[] {
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

const PANEL: Paint = { colour: INK.colour, amount: 0.12 }
/** The bars of a block of several volumes run across them all, from the middle of its mass. */
const BLOCK_CENTRE = [ZERO, ZERO] as const

function concreteBlock(pieces: readonly string[]): Part[] {
  const has = (id: string) => pieces.includes(id)
  const parts: Part[] = []
  const H = HEIGHT
  const h2 = times(SIDE, 0.5)
  const low = times(h2, -1)
  const mass = has('P') ? 'P' : has('N') ? 'N' : has('W') ? 'W' : 'S'
  const top = has('R') ? 'R' : has('M') ? 'M' : 'F'
  // A sloping top rises towards the back
  const rise = top === 'M' ? size('concreteBlock', 'M', 'rise') : ZERO
  // y is a share of the side here: the top falls from the back (−s/2) to the front (+s/2)
  const slopeAt = (y: Length): Length => plus(H, times(rise, 0.5 - y[1]))
  const volumes: {
    corners: readonly [Length, Length, Length, Length]
    top: Length
    against?: boolean
  }[] = []
  if (mass === 'S') {
    volumes.push({ corners: [low, low, h2, h2], top: H })
  } else if (mass === 'P') {
    const half = times(minus(SIDE, size('concreteBlock', 'P', 'gap')), 0.5)
    volumes.push({ corners: [low, low, plus(low, half), h2], top: H })
    volumes.push({ corners: [minus(h2, half), low, h2, h2], top: H })
  } else if (mass === 'N') {
    const backY = plus(low, size('concreteBlock', 'N', 'back depth'))
    volumes.push({ corners: [low, low, h2, backY], top: H })
    volumes.push({
      corners: [low, backY, plus(low, size('concreteBlock', 'N', 'front width')), h2],
      top: H,
      against: true,
    })
  } else {
    const backY = plus(low, size('concreteBlock', 'W', 'main depth'))
    volumes.push({ corners: [low, low, h2, backY], top: H })
    volumes.push({
      corners: [low, backY, h2, h2],
      top: minus(H, size('concreteBlock', 'W', 'step down')),
      against: true,
    })
  }
  for (const volume of volumes) {
    const [x0, y0, x1, y1] = volume.corners
    const level: readonly [Length, Length] | Length =
      top === 'M' ? [slopeAt(y0), slopeAt(y1)] : volume.top
    parts.push(
      cuboid(volume.corners, ZERO, level, CONCRETE_WALL, CONCRETE_ROOF, {
        omit: volume.against ? ['y-'] : [],
        stamp: true,
        stampCentre: BLOCK_CENTRE,
      }),
    )
    if (top === 'R') {
      const rim = size('concreteBlock', 'R', 'rim')
      const z = plus(volume.top, length(0.004))
      parts.push({
        faces: [
          {
            // The panel covers the top: the bars go on it
            paint: PANEL,
            stamp: true,
            stampCentre: BLOCK_CENTRE,
            points: [
              [plus(x0, rim), plus(y0, rim), z],
              [minus(x1, rim), plus(y0, rim), z],
              [minus(x1, rim), minus(y1, rim), z],
              [plus(x0, rim), minus(y1, rim), z],
            ],
          },
        ],
        centre: [middle(x0, x1), middle(y0, y1), volume.top],
      })
    }
  }
  if (has('dk')) {
    const half = times(size('concreteBlock', 'dk', 'length'), 0.5)
    parts.push(
      cuboid(
        [times(half, -1), h2, half, plus(h2, size('concreteBlock', 'dk', 'depth'))],
        ZERO,
        size('concreteBlock', 'dk', 'height'),
        CONCRETE_WALL,
        CONCRETE_ROOF,
        { omit: ['y-'] },
      ),
    )
  }
  if (has('sh')) {
    const width = size('concreteBlock', 'sh', 'width')
    const centre = size('concreteBlock', 'sh', 'offset from centre')
    const half = times(width, 0.5)
    parts.push(
      cuboid(
        [h2, minus(centre, half), plus(h2, width), plus(centre, half)],
        ZERO,
        top === 'M' ? slopeAt(centre) : H,
        CONCRETE_WALL,
        CONCRETE_ROOF,
        { omit: ['x-'] },
      ),
    )
  }
  return parts
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
