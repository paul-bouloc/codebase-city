// The kit of the low buildings' variants: pieces, sizes, rules and frequencies, from the design's
// table. A size is `[fixed, ×side, ×height, ×depth]`, in u: the depth is that of the volume the
// piece sits on.

/** `[fixed, side, height, depth]` coefficients, in u. */
export type Size = readonly [number, number, number, number]

/** When a piece may be chosen, given the building and the pieces chosen before it. */
export interface Rule {
  sMin?: number
  sMax?: number
  /** Floors it allows. */
  floors?: readonly number[]
  /** At least one of these. */
  needs?: readonly string[]
  /** All of these. */
  needsAll?: readonly string[]
  /** None of these. */
  excludes?: readonly string[]
}

export interface Piece {
  id: string
  slot: string
  /** Weight within a slot of one piece; chance of its own for an accessory. */
  freq: number
  /** Comes with another piece, never drawn. */
  auto?: boolean
  rule: Rule
  sizes: Readonly<Record<string, Size>>
}

export interface Slot {
  id: string
  /** One piece exactly, or any number. */
  one: boolean
}

export interface Kit {
  slots: readonly Slot[]
  pieces: readonly Piece[]
}

export type VariantArchetype = 'house' | 'pavilion' | 'concreteBlock'

/** Limits every combination keeps: footprint in u, triangles, turn in degrees, rise above the reference in u. */
export const KIT_LIMITS = { footprint: 1.8, triangles: 50, maxTurn: 15, overTop: 0.4 } as const
/** A house's eaves overhang its walls by this much on every side, in u. */
export const HOUSE_EAVE = 0.04
/** Height under a pavilion's roof, in u, at one floor and at two. */
export const PAVILION_HEIGHTS = [0.75, 1.0] as const

export const KIT: Readonly<Record<VariantArchetype, Kit>> = {
  house: {
    slots: [
      { id: 'body', one: true },
      { id: 'roof', one: true },
      { id: 'acc', one: false },
    ],
    pieces: [
      {
        id: 'S',
        slot: 'body',
        freq: 0.75,
        rule: {},
        sizes: {
          length: [0, 1, 0, 0],
          'length with annex': [0, 0.85, 0, 0],
          depth: [0, 0.74, 0, 0],
          'wall height': [0, 0, 1, 0],
        },
      },
      {
        id: 'L',
        slot: 'body',
        freq: 0.25,
        rule: { sMin: 1.0 },
        sizes: {
          'main length': [0, 1, 0, 0],
          'main depth': [0, 0.56, 0, 0],
          'wing length': [0, 0.44, 0, 0],
          'wing depth': [0, 0.32, 0, 0],
        },
      },
      { id: 'G', slot: 'roof', freq: 0.55, rule: {}, sizes: { rise: [0, 0, 0, 0.42] } },
      {
        id: 'H',
        slot: 'roof',
        freq: 0.3,
        rule: { needs: ['S'] },
        sizes: { rise: [0, 0, 0, 0.36] },
      },
      {
        id: 'P',
        slot: 'roof',
        freq: 0.15,
        rule: { needs: ['S'] },
        sizes: { rise: [0, 0, 0, 0.3] },
      },
      {
        id: 'ax',
        slot: 'acc',
        freq: 0.22,
        rule: { sMin: 1.0, sMax: 1.4, needsAll: ['S'] },
        sizes: {
          length: [0, 0.3, 0, 0],
          depth: [0, 0, 0, 0.6],
          'height at house': [0.34, 0, 0, 0],
          'height outside': [0.26, 0, 0, 0],
        },
      },
      {
        id: 'vr',
        slot: 'acc',
        freq: 0.18,
        rule: { sMin: 1.1, needsAll: ['S'], excludes: ['ax'] },
        sizes: {
          length: [0, 0.5, 0, 0],
          depth: [0.26, 0, 0, 0],
          height: [0.34, 0, 0, 0],
          'offset along wall': [0, -0.15, 0, 0],
        },
      },
      {
        id: 'cn',
        slot: 'acc',
        freq: 0.45,
        rule: { excludes: ['vr'] },
        sizes: {
          width: [0.4, 0, 0, 0],
          depth: [0.16, 0, 0, 0],
          height: [0.36, 0, 0, 0],
          'offset along wall': [0, 0.18, 0, 0],
        },
      },
      {
        id: 'dm',
        slot: 'acc',
        freq: 0.35,
        rule: { sMin: 1.1, floors: [1], needs: ['G', 'H'], needsAll: ['S'] },
        sizes: {
          width: [0.26, 0, 0, 0],
          'set back from wall': [0.1, 0, 0, 0],
          'cap rise': [0.06, 0, 0, 0],
          'offset along ridge': [0, -0.22, 0, 0],
        },
      },
      {
        id: 'ch',
        slot: 'acc',
        freq: 0.35,
        rule: {},
        sizes: {
          width: [0.14, 0, 0, 0],
          'offset along ridge': [0, 0.3, 0, 0],
          'offset across ridge': [0, -0.12, 0, 0],
          'above ridge': [0.25, 0, 0, 0],
        },
      },
    ],
  },
  pavilion: {
    slots: [
      { id: 'frame', one: true },
      { id: 'deck', one: true },
      { id: 'roof', one: true },
      { id: 'acc', one: false },
    ],
    pieces: [
      {
        id: 'BW',
        slot: 'frame',
        freq: 0.4,
        rule: {},
        sizes: {
          thickness: [0.18, 0, 0, 0],
          'end inset': [0.05, 0, 0, 0],
          length: [-0.1, 1, 0, 0],
        },
      },
      {
        id: 'SW',
        slot: 'frame',
        freq: 0.2,
        rule: {},
        sizes: {
          thickness: [0.18, 0, 0, 0],
          'end inset': [0.05, 0, 0, 0],
          length: [-0.1, 1, 0, 0],
        },
      },
      {
        id: 'CW',
        slot: 'frame',
        freq: 0.2,
        rule: {},
        sizes: {
          thickness: [0.18, 0, 0, 0],
          'end inset': [0.05, 0, 0, 0],
          length: [-0.1, 1, 0, 0],
        },
      },
      {
        id: 'SC',
        slot: 'frame',
        freq: 0.2,
        rule: {},
        sizes: { thickness: [0.06, 0, 0, 0], length: [0, 0.45, 0, 0] },
      },
      {
        id: 'post',
        slot: 'support',
        freq: 0,
        auto: true,
        rule: {},
        sizes: { width: [0.07, 0, 0, 0], inset: [0.08, 0, 0, 0] },
      },
      { id: 'D', slot: 'deck', freq: 0.7, rule: {}, sizes: { thickness: [0.06, 0, 0, 0] } },
      {
        id: 'T',
        slot: 'deck',
        freq: 0.3,
        rule: { sMax: 1.3 },
        sizes: { thickness: [0.06, 0, 0, 0], 'front extension': [0.3, 0, 0, 0] },
      },
      {
        id: 'F',
        slot: 'roof',
        freq: 0.65,
        rule: {},
        sizes: { overhang: [0.13, 0, 0, 0], thickness: [0.09, 0, 0, 0] },
      },
      {
        id: 'M',
        slot: 'roof',
        freq: 0.35,
        rule: {},
        sizes: {
          overhang: [0.13, 0, 0, 0],
          thickness: [0.09, 0, 0, 0],
          'front lift': [0.14, 0, 0, 0],
        },
      },
      {
        id: 'bn',
        slot: 'acc',
        freq: 0.5,
        rule: {},
        sizes: { length: [0, 0.6, 0, 0], depth: [0.16, 0, 0, 0], height: [0.14, 0, 0, 0] },
      },
    ],
  },
  concreteBlock: {
    slots: [
      { id: 'mass', one: true },
      { id: 'top', one: true },
      { id: 'acc', one: false },
    ],
    pieces: [
      {
        id: 'S',
        slot: 'mass',
        freq: 0.45,
        rule: {},
        sizes: { side: [0, 1, 0, 0], height: [0, 0, 1, 0] },
      },
      { id: 'P', slot: 'mass', freq: 0.15, rule: {}, sizes: { gap: [0.08, 0, 0, 0] } },
      {
        id: 'N',
        slot: 'mass',
        freq: 0.2,
        rule: {},
        sizes: { 'back depth': [0, 0.6, 0, 0], 'front width': [0, 0.6, 0, 0] },
      },
      {
        id: 'W',
        slot: 'mass',
        freq: 0.2,
        rule: { floors: [2, 3, 4] },
        sizes: { 'main depth': [0, 0.65, 0, 0], 'step down': [0.5, 0, 0, 0] },
      },
      { id: 'F', slot: 'top', freq: 0.4, rule: {}, sizes: {} },
      { id: 'R', slot: 'top', freq: 0.4, rule: {}, sizes: { rim: [0.06, 0, 0, 0] } },
      {
        id: 'M',
        slot: 'top',
        freq: 0.2,
        rule: { needs: ['S', 'P'] },
        sizes: { rise: [0.15, 0, 0, 0] },
      },
      {
        id: 'dk',
        slot: 'acc',
        freq: 0.2,
        rule: { sMax: 1.5 },
        sizes: { length: [0, 0.7, 0, 0], depth: [0.22, 0, 0, 0], height: [0.18, 0, 0, 0] },
      },
      {
        id: 'sh',
        slot: 'acc',
        freq: 0.15,
        rule: { sMax: 1.5, floors: [2, 3, 4] },
        sizes: { width: [0.3, 0, 0, 0], 'offset from centre': [0, -0.2, 0, 0] },
      },
    ],
  },
}
