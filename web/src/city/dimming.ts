import { type IUniform, Vector4 } from 'three'
import { srgb } from './world/units'

// Outside a selection, buildings and trees fade toward a pale stone (72 %), and the shadows cast
// on them halve. The ground, the water and the bridges keep their colours: islands stay readable.

const DIMMED = srgb('#E6E1D6')
const DIM_SHARE = 0.72
const DIMMED_SHADOWS = 0.5

/** `dimmed(colour, dim)` and `dimmedShadows(dim)`, for a dim factor from 0 to 1. */
export const dimmingFragmentPars = /* glsl */ `
vec3 dimmed(vec3 colour, float dim) {
  return mix(colour, vec3(${DIMMED.map((c) => c.toFixed(6)).join(', ')}), ${DIM_SHARE.toFixed(6)} * dim);
}
float dimmedShadows(float dim) {
  return mix(1.0, ${DIMMED_SHADOWS.toFixed(6)}, dim);
}
`

/** What the buildings and the trees share to fade together. */
export interface Fading {
  /** How faded what is not kept is, from 0 to 1. */
  dim: IUniform<number>
  /** The trees kept from fading: those in this area, x and z of three.js, min then max. */
  keptArea: IUniform<Vector4>
}

export function createFading(): Fading {
  return { dim: { value: 0 }, keptArea: { value: new Vector4(1, 1, 0, 0) } }
}
