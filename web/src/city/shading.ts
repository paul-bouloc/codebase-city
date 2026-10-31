import { type IUniform, UniformsLib, UniformsUtils, Vector3 } from 'three'
import { AMBIENT, DIFFUSE, NORMALIZER, SHADOW_COLOR, SHADOW_OPACITY, SUN_DIRECTION } from './light'
import { srgb } from './units'

// The city's materials shade in sRGB, like the design, instead of three.js lighting: a face
// is scaled by k = (ambient + diffuse × n·L) / normalizer, and a cast shadow is a 16 % tint,
// not a loss of light. Their output is already sRGB, so they skip the colour space conversion:
// this holds as long as the scene renders straight to the canvas.

const glslFloat = (value: number) => value.toFixed(6)

/** three.js light uniforms (for the shadow map) and the sun. */
export function shadingUniforms(): Record<string, IUniform> {
  return UniformsUtils.merge([
    UniformsLib.lights,
    {
      sunDirection: { value: new Vector3(...SUN_DIRECTION) },
      shadowColor: { value: new Vector3(...srgb(SHADOW_COLOR)) },
      shadowOpacity: { value: SHADOW_OPACITY },
    },
  ])
}

export const shadingVertexPars = /* glsl */ `
#include <common>
#include <shadowmap_pars_vertex>
varying vec3 vWorldNormal;
`

/** Projects the vertex and prepares the shadow lookup; needs `position` and `normal`. */
export const shadingVertex = /* glsl */ `
#include <beginnormal_vertex>
#include <defaultnormal_vertex>
#include <begin_vertex>
#include <project_vertex>
#include <worldpos_vertex>
#include <shadowmap_vertex>
vWorldNormal = inverseTransformDirection(transformedNormal, viewMatrix);
`

export const shadingFragmentPars = /* glsl */ `
#include <common>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
uniform vec3 sunDirection;
uniform vec3 shadowColor;
uniform float shadowOpacity;
varying vec3 vWorldNormal;

// The same formula as lightFactor() in light.ts, which the tests check: change both together.
vec3 shade(vec3 color, vec3 normal) {
  float nDotL = dot(normal, sunDirection);
  vec3 lit = color * (${glslFloat(AMBIENT)} + ${glslFloat(DIFFUSE)} * max(nDotL, 0.0))
    / ${glslFloat(NORMALIZER)};
  // Faces turned from the sun are dark already: only the faces it reaches take cast shadows.
  float shadow = nDotL > 0.0 ? 1.0 - getShadowMask() : 0.0;
  return mix(lit, shadowColor, shadowOpacity * shadow);
}
`
