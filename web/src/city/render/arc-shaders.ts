// The shaders of the selection's arcs: ribbons a fixed width on screen over a white halo, with
// dashes that move toward the target, and round dots at their ends.

/** How opaque a ribbon's white halo is. */
const HALO_OPACITY = 0.9
/** A dash period shorter than this many device pixels fills in, from the first to the second. */
const SOLID_BELOW = [6, 12] as const
/** Still, the arc shows its way by two light spots this far before its target, in u. */
const STILL_SPOTS = [1, 2] as const

export const lineVertex = /* glsl */ `
uniform vec2 resolution;
uniform float halo;
attribute vec3 start;
attribute vec3 end;
attribute vec2 corner;
attribute float distance;
attribute float total;
attribute float width;
attribute vec3 colour;
attribute vec2 dash;
attribute float grows;
varying float vDistance;
varying float vTotal;
varying float vAcross;
varying float vWidth;
varying vec3 vColour;
varying vec2 vDash;
varying float vGrows;
void main() {
  vec4 a = projectionMatrix * modelViewMatrix * vec4(start, 1.0);
  vec4 b = projectionMatrix * modelViewMatrix * vec4(end, 1.0);
  // An arc rises high: close up, a segment may pass behind the camera, where w turns negative
  // and its quad flips across the screen. It is cut at the near plane, or dropped if all behind.
  float nearA = a.z + a.w;
  float nearB = b.z + b.w;
  if (nearA < 0.0 && nearB < 0.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  if (nearA < 0.0) {
    a = mix(a, b, nearA / (nearA - nearB) + 1e-4);
  } else if (nearB < 0.0) {
    b = mix(b, a, nearB / (nearB - nearA) + 1e-4);
  }
  vec4 here = corner.x < 0.5 ? a : b;
  vec2 along = normalize((b.xy / b.w - a.xy / a.w) * resolution + 1e-6);
  vec2 normal = vec2(-along.y, along.x);
  float reach = (width + 2.0 * halo) * 0.5 + 0.5;
  vec2 offset = (normal * corner.y * reach + along * (corner.x * 2.0 - 1.0) * reach) / resolution;
  gl_Position = here + vec4(offset * 2.0 * here.w, 0.0, 0.0);
  vDistance = distance;
  vTotal = total;
  vAcross = corner.y * reach;
  vWidth = width;
  vColour = colour;
  vDash = dash;
  vGrows = grows;
}
`

export const lineFragment = /* glsl */ `
uniform float halo;
uniform float opacity;
uniform float phase;
uniform float still;
uniform float growth;
varying float vDistance;
varying float vTotal;
varying float vAcross;
varying float vWidth;
varying vec3 vColour;
varying vec2 vDash;
varying float vGrows;
float spot(float at, float back) {
  return 1.0 - smoothstep(0.15, 0.25, abs(back - at));
}
void main() {
  float cover = clamp((vWidth + 2.0 * halo) * 0.5 - abs(vAcross) + 0.5, 0.0, 1.0);
  if (cover <= 0.0) {
    discard;
  }
  // An arc just opened shows only as far as it has grown.
  float grown = vGrows > 0.0 ? vDistance : vTotal - vDistance;
  if (vGrows != 0.0 && grown > growth * vTotal) {
    discard;
  }
  if (halo > 0.0) {
    gl_FragColor = vec4(1.0, 1.0, 1.0, ${HALO_OPACITY.toFixed(2)} * opacity * cover);
    return;
  }
  float period = vDash.x + vDash.y;
  // From afar, once a dash and its gap span too few pixels to read, the gaps fill in.
  float pixels = period / max(fwidth(vDistance), 1e-6);
  float solid = 1.0 - smoothstep(${SOLID_BELOW[0].toFixed(1)}, ${SOLID_BELOW[1].toFixed(1)}, pixels);
  // The dashes move toward the target.
  float on = step(mod(vDistance - phase * period, period), vDash.x);
  vec3 colour = vColour;
  if (still > 0.5) {
    float back = vTotal - vDistance;
    float spots = max(spot(${STILL_SPOTS[0].toFixed(1)}, back), spot(${STILL_SPOTS[1].toFixed(1)}, back));
    colour = mix(colour, vec3(1.0), 0.7 * spots);
    on = max(on, spots);
  }
  cover *= max(on, solid);
  if (cover <= 0.0) {
    discard;
  }
  gl_FragColor = vec4(colour, opacity * cover);
}
`

export const dotVertex = /* glsl */ `
attribute float size;
attribute float rim;
attribute vec3 colour;
attribute vec3 rimColour;
varying float vSize;
varying float vRim;
varying vec3 vColour;
varying vec3 vRimColour;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size + 2.0 * rim + 2.0;
  vSize = size;
  vRim = rim;
  vColour = colour;
  vRimColour = rimColour;
}
`

export const dotFragment = /* glsl */ `
uniform float opacity;
varying float vSize;
varying float vRim;
varying vec3 vColour;
varying vec3 vRimColour;
void main() {
  float d = length(gl_PointCoord - 0.5) * (vSize + 2.0 * vRim + 2.0);
  float outer = clamp(vSize * 0.5 + vRim - d + 0.5, 0.0, 1.0);
  if (outer <= 0.0) {
    discard;
  }
  float inner = clamp(vSize * 0.5 - d + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(mix(vRimColour, vColour, inner), opacity * outer);
}
`
