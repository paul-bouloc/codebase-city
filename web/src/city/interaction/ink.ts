import { srgb } from '../world/units'

/** The ink of the marks: outlines, rings and the pin. */
export const INK = srgb('#23313A')

/** Paints a mark in one plain colour. */
export const flatFragment = /* glsl */ `
uniform vec3 colour;
void main() {
  gl_FragColor = vec4(colour, 1.0);
}
`
