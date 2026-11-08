import type { IslandShape, Side } from '../terrain/island-shape'
import type { Rect } from '../world/layout'
import type { Bridge } from './links'

// Where things may stand along the sides of an island: which way a side looks, how far out to
// sea, and the stretches its canals' mouths and bridges' decks already take.

/** Room kept between a deck and a canal's mouth, or the end of the sides it lands on. */
export const LANDING_CLEARANCE = 2

/** Landing positions are tried this far apart, outward from the one wanted. */
export const LANDING_STEP = 0.25

/** A side looks out to sea as far as this, in u, at most; farther makes no difference. */
const OPEN_ENOUGH = 30
/** How much a pier prefers a side that looks out to sea over one that faces the other island. */
const OPENNESS_WEIGHT = 0.6

/**
 * The side of an island that looks out the farthest: open sea if one does, else the widest
 * channel; the west first when two look alike.
 */
export function openSide(plateaux: readonly Rect[], island: number): Side {
  return SIDES.reduce((best, side) =>
    lookout(plateaux, island, side) > lookout(plateaux, island, best) ? side : best,
  )
}

export const SIDES: Side[] = ['west', 'east', 'south', 'north']

/** How far a side of an island looks out before another island: infinite on the open sea. */
function lookout(plateaux: readonly Rect[], island: number, side: Side): number {
  const plateau = plateaux[island]
  if (!plateau) {
    return 0
  }
  let nearest = Number.POSITIVE_INFINITY
  plateaux.forEach((other, index) => {
    if (index === island) {
      return
    }
    const gap = {
      west: plateau.x - (other.x + other.width),
      east: other.x - (plateau.x + plateau.width),
      south: plateau.y - (other.y + other.height),
      north: other.y - (plateau.y + plateau.height),
    }[side]
    const across =
      side === 'west' || side === 'east'
        ? other.y < plateau.y + plateau.height && plateau.y < other.y + other.height
        : other.x < plateau.x + plateau.width && plateau.x < other.x + other.width
    if (gap > 0 && across) {
      nearest = Math.min(nearest, gap)
    }
  })
  return nearest
}

/**
 * The side of an island a ferry to another one leaves from: the one that turns most toward it,
 * a side that looks out to sea preferred to one facing a neighbour across a channel.
 */
export function sideToward(plateaux: readonly Rect[], island: number, target: number): Side {
  const from = plateaux[island]
  const to = plateaux[target]
  if (!from || !to) {
    return 'west'
  }
  const dx = to.x + to.width / 2 - (from.x + from.width / 2)
  const dy = to.y + to.height / 2 - (from.y + from.height / 2)
  const length = Math.hypot(dx, dy) || 1
  const score = (side: Side) => {
    const [nx, ny] = NORMALS[side]
    const open = Math.min(lookout(plateaux, island, side), OPEN_ENOUGH) / OPEN_ENOUGH
    return (nx * dx + ny * dy) / length + OPENNESS_WEIGHT * open
  }
  return SIDES.reduce((best, side) => (score(side) > score(best) + 1e-9 ? side : best))
}

export function bridgeSides(bridge: Bridge): string[] {
  return bridge.axis === 'x'
    ? [`${bridge.low}/east`, `${bridge.high}/west`]
    : [`${bridge.low}/north`, `${bridge.high}/south`]
}

/** Where bridges land on a side of an island, along that side. */
export function decksOn(
  bridges: readonly Bridge[],
  island: number,
  side: Side,
): [number, number][] {
  return bridges
    .filter((bridge) => bridgeSides(bridge).includes(`${island}/${side}`))
    .map((bridge) => [bridge.at - bridge.width / 2, bridge.at + bridge.width / 2])
}

/** The stretches of a side where canals pour over the edge, along that side. */
export function mouthsOn(shape: IslandShape | undefined, side: Side): [number, number][] {
  if (!shape) {
    return []
  }
  return shape.canals.cells
    .filter((cell) => cell.mouth === side)
    .map(({ rect }) =>
      side === 'east' || side === 'west'
        ? [rect.y, rect.y + rect.height]
        : [rect.x, rect.x + rect.width],
    )
}

export const NORMALS: Record<Side, [number, number]> = {
  south: [0, -1],
  east: [1, 0],
  north: [0, 1],
  west: [-1, 0],
}
