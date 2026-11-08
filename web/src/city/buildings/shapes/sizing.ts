import { HALL_MIN_SIDE, MAX_SIDE, MIN_SIDE, PAVILION_MAX_SIDE } from '../archetypes'
import { type Length, length, plus, times, ZERO } from '../parts'
import { KIT, type VariantArchetype } from '../variants-kit'

/** A size of the kit as a length; `depth` is that of the volume the piece sits on. */
export function size(
  archetype: VariantArchetype,
  piece: string,
  name: string,
  depth = ZERO,
): Length {
  const value = KIT[archetype].pieces.find(({ id }) => id === piece)?.sizes[name]
  if (!value) {
    throw new Error(`The kit has no ${name} for ${archetype} ${piece}`)
  }
  return plus(length(value[0], value[1], value[2]), times(depth, value[3]))
}

/** The sides each archetype takes, so lengths the design defines by ratios fit them best. */
export const SIDES: Record<VariantArchetype, readonly [number, number]> = {
  house: [MIN_SIDE, HALL_MIN_SIDE],
  pavilion: [MIN_SIDE, PAVILION_MAX_SIDE],
  concreteBlock: [MIN_SIDE, MAX_SIDE],
}

/** The value of a length on the side `s`, without height: footprints never follow it. */
export const onSide = (value: Length, side: number) => value[0] + value[1] * side
