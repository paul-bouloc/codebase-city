import {
  CONCRETE_ROOF,
  CONCRETE_WALL,
  cuboid,
  HEIGHT,
  INK,
  type Length,
  length,
  middle,
  minus,
  type Paint,
  type Part,
  plus,
  SIDE,
  times,
  ZERO,
} from '../parts'
import { size } from './sizing'

const PANEL: Paint = { colour: INK.colour, amount: 0.12 }
/** The bars of a block of several volumes run across them all, from the middle of its mass. */
const BLOCK_CENTRE = [ZERO, ZERO] as const

export function concreteBlock(pieces: readonly string[]): Part[] {
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
