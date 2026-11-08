import { seededRandom } from '../world/random'
import { KIT, type Piece, type VariantArchetype } from './variants-kit'

/** What the data fix about a building, which the kit's rules read. */
export interface VariantContext {
  /** Side of the footprint, in u. */
  side: number
  floors: number
}

/** The design's names, which seed the draw: the same file gives the building of the boards. */
const SEED_NAMES: Record<VariantArchetype, string> = {
  house: 'house',
  pavilion: 'pavilion',
  concreteBlock: 'concrete',
}

const TOLERANCE = 1e-9

function allowed(piece: Piece, { side, floors }: VariantContext, chosen: readonly string[]) {
  const { sMin, sMax, floors: allowedFloors, needs, needsAll, excludes } = piece.rule
  return (
    (sMin === undefined || side >= sMin - TOLERANCE) &&
    (sMax === undefined || side <= sMax + TOLERANCE) &&
    (allowedFloors === undefined || allowedFloors.includes(floors)) &&
    (needsAll === undefined || needsAll.every((id) => chosen.includes(id))) &&
    (needs === undefined || needs.some((id) => chosen.includes(id))) &&
    (excludes === undefined || !excludes.some((id) => chosen.includes(id)))
  )
}

/**
 * The pieces of a building, drawn from its file's path: one piece for each slot of one, then
 * each accessory on its own chance, every piece within the rules of those chosen before it.
 */
export function pickVariant(
  archetype: VariantArchetype,
  path: string,
  context: VariantContext,
): string[] {
  const random = seededRandom(`${path}|${SEED_NAMES[archetype]}`)
  const { slots, pieces } = KIT[archetype]
  const chosen: string[] = []
  for (const slot of slots) {
    const candidates = pieces.filter(
      (piece) => piece.slot === slot.id && !piece.auto && allowed(piece, context, chosen),
    )
    if (slot.one) {
      const draw = random() * candidates.reduce((total, piece) => total + piece.freq, 0)
      let reached = 0
      const picked =
        candidates.find((piece) => {
          reached += piece.freq
          return draw < reached
        }) ?? candidates.at(-1)
      if (picked) {
        chosen.push(picked.id)
      }
    } else {
      for (const piece of candidates) {
        // An accessory chosen in this slot may rule out the next one
        if (random() < piece.freq && allowed(piece, context, chosen)) {
          chosen.push(piece.id)
        }
      }
    }
  }
  return chosen
}

/** How many quarter turns a pavilion or a concrete block makes, from its file's path. */
export function quarterTurnsFor(path: string): number {
  return Math.floor(seededRandom(`${path}|orient`)() * 4)
}
