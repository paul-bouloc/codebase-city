import type { IslandShape, Side } from '../terrain/island-shape'
import type { CityLayout, Point, Rect } from '../world/layout'
import {
  decksOn,
  LANDING_CLEARANCE,
  LANDING_STEP,
  mouthsOn,
  NORMALS,
  openSide,
  sideToward,
} from './island-sides'
import type { Bridge, CityLinks, Quay } from './links'

// Quays stand on the beach of an island and reach out to sea: a ferry's pier, or a port's
// broader quay, each kept clear of canals' mouths, bridges' decks and the other quays.

/** A ferry's pier: from the beach out into the water. */
const PIER = { width: 0.6, length: 2.4 }
/** A port's quay, broader and longer: it gathers the links an island has no room to draw. */
const PORT_QUAY = { width: 1.4, length: 3.4 }
/** How far up the beach a quay starts. */
export const QUAY_ROOT = 0.8
/**
 * A quay keeps to its half of the water ahead, and the line's room in the middle: it may shrink
 * to this, past the beach.
 */
const QUAY_MIN = 0.8
const MID_CHANNEL = 0.5

/** The stretch of its side a quay takes. */
export function quayStretch(quay: Quay): [number, number] {
  const along = quay.nx !== 0 ? quay.y : quay.x
  return [along - quay.width / 2, along + quay.width / 2]
}

/**
 * A quay `share` of the way along a side, from its south or west end, or as near there as it
 * keeps 2 u from every stretch `taken` (a canal's mouth, where a cascade pours into a pool; a
 * bridge's deck; another quay), without leaving the side.
 */
export function quayAt(
  shape: IslandShape,
  island: number,
  side: Side,
  share: number,
  port: boolean,
  plateaux: readonly Rect[],
  taken: readonly [number, number][] = [],
): Quay {
  const { plateau } = shape.island
  const vertical = side === 'east' || side === 'west'
  const start = vertical ? plateau.y : plateau.x
  const length = vertical ? plateau.height : plateau.width
  const size = port ? PORT_QUAY : PIER
  const half = size.width / 2
  const lowest = start + half
  const highest = start + length - half
  const wanted = Math.min(Math.max(start + share * length, lowest), highest)
  // How far the quay stands from the nearest taken stretch: free from 2 u on.
  const room = (at: number) =>
    taken.reduce(
      (least, [t0, t1]) => Math.min(least, Math.max(t0 - (at + half), at - half - t1)),
      Number.POSITIVE_INFINITY,
    )
  // The nearest free position; on a side with none, the one with the most room.
  let along = wanted
  let best = room(wanted)
  const steps = Math.ceil((highest - lowest) / LANDING_STEP)
  for (let k = 1; k <= 2 * steps && best < LANDING_CLEARANCE; k++) {
    const at = wanted + Math.ceil(k / 2) * LANDING_STEP * (k % 2 === 0 ? 1 : -1)
    if (at < lowest - 1e-9 || at > highest + 1e-9) {
      continue
    }
    const space = room(at)
    if (space > best + 1e-9) {
      along = at
      best = space
    }
  }
  // `offsetsAt` measures counter-clockwise from the side's start: west and north run backward.
  const fromStart = side === 'west' || side === 'north' ? start + length - along : along - start
  const beach = shape.offsetsAt(side, fromStart).at(-1) ?? 0
  const [nx, ny] = NORMALS[side]
  const out = beach - QUAY_ROOT
  const edge = {
    south: plateau.y,
    north: plateau.y + plateau.height,
    west: plateau.x,
    east: plateau.x + plateau.width,
  }[side]
  // The water ahead, up to the next plateau facing this point of the side.
  let ahead = Number.POSITIVE_INFINITY
  plateaux.forEach((other, index) => {
    if (index === island) {
      return
    }
    const [o0, o1] = vertical ? [other.y, other.y + other.height] : [other.x, other.x + other.width]
    if (along < o0 || along > o1) {
      return
    }
    const gap = {
      west: plateau.x - (other.x + other.width),
      east: other.x - (plateau.x + plateau.width),
      south: plateau.y - (other.y + other.height),
      north: other.y - (plateau.y + plateau.height),
    }[side]
    if (gap > 0) {
      ahead = Math.min(ahead, gap)
    }
  })
  const reach = Math.min(size.length, Math.max(QUAY_MIN, ahead / 2 - MID_CHANNEL - beach))
  return {
    island,
    side,
    x: vertical ? edge + nx * out : along,
    y: vertical ? along : edge + ny * out,
    nx,
    ny,
    length: QUAY_ROOT + reach,
    width: size.width,
    port,
  }
}

/**
 * A pier for a line shown for a while only: on the side of `island` that turns toward `toward`,
 * clear of its canals' mouths, bridges and quays. Nothing is built there.
 */
export function passingPier(
  layout: CityLayout,
  shapes: readonly IslandShape[],
  links: Pick<CityLinks, 'bridges' | 'quays'>,
  island: number,
  toward: number,
): Quay | null {
  const shape = shapes[island]
  if (!shape) {
    return null
  }
  const plateaux = layout.islands.map((each) => each.plateau)
  const side = sideToward(plateaux, island, toward)
  const taken = [
    ...mouthsOn(shape, side),
    ...decksOn(links.bridges, island, side),
    ...links.quays
      .filter((quay) => quay.island === island && quay.side === side)
      .map((quay) => quayStretch(quay)),
  ]
  return quayAt(shape, island, side, 0.5, false, plateaux, taken)
}

/** The end of a quay, out on the water. */
export function tipOf(quay: Quay): Point {
  return { x: quay.x + quay.nx * quay.length, y: quay.y + quay.ny * quay.length }
}

/** A small city's quay: on its largest island, on the side that looks out to the open sea. */
export function loneQuay(
  layout: CityLayout,
  shapes: readonly IslandShape[],
  bridges: readonly Bridge[],
): Quay | null {
  let largest = 0
  layout.islands.forEach((island, index) => {
    const best = layout.islands[largest]?.plateau
    if (best && island.plateau.width * island.plateau.height > best.width * best.height) {
      largest = index
    }
  })
  const shape = shapes[largest]
  if (!shape) {
    return null
  }
  const side = openSide(
    layout.islands.map((island) => island.plateau),
    largest,
  )
  return quayAt(
    shape,
    largest,
    side,
    0.5,
    false,
    layout.islands.map((island) => island.plateau),
    [...mouthsOn(shape, side), ...decksOn(bridges, largest, side)],
  )
}
