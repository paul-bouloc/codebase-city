import {
  cuboid,
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
  TRIM,
  times,
  toward,
  WALL,
  WHITE,
  ZERO,
} from '../parts'
import { HOUSE_EAVE } from '../variants-kit'
import { dormer } from './dormer'
import { size } from './sizing'

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

export function house(pieces: readonly string[]): Part[] {
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
