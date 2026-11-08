import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type IUniform,
  Mesh,
  Points,
  ShaderMaterial,
  type Vector2,
  Vector3,
} from 'three'
import { srgb, type Vec3 } from '../world/units'
import { flatFragment, INK } from './ink'

// The selected building's pin: a stem straight up from its roof and a round head on top.

/** The rim around the pin's head. */
const WHITE = srgb('#FFFFFF')

/**
 * The pin stands straight up above the roof, in the scene: from this far over it, this tall in
 * u, but never shorter on screen than its least length in CSS pixels, so that a far building's
 * pin still shows. Then its stem's width, its head and the head's white rim, in CSS pixels.
 */
const STEM_FROM = 0.4
const STEM_LENGTH = 2.2
const STEM_MINIMUM = 28
const STEM_WIDTH = 2
const HEAD = 12
const HEAD_RIM = 2.5

// Where the pin's top is: up from its foot (`position`), by its length in u or more when far.
const pinTop = /* glsl */ `
uniform vec2 resolution;
uniform float stemLength;
uniform float stemMinimum;
vec3 pinTop() {
  vec4 foot = modelViewMatrix * vec4(position, 1.0);
  float pixelsPerUnit = resolution.y * projectionMatrix[1][1] * 0.5 / max(-foot.z, 1e-3);
  return position + vec3(0.0, max(stemLength, stemMinimum / pixelsPerUnit), 0.0);
}
`

// The stem is a quad from the foot to the top, as wide on screen at any distance: `corner` is
// its side (−1 or 1) and how far up it is (0 or 1).
const stemVertex = /* glsl */ `
${pinTop}
uniform float width;
attribute vec2 corner;
void main() {
  vec4 foot = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec4 top = projectionMatrix * modelViewMatrix * vec4(pinTop(), 1.0);
  vec2 along = (top.xy / top.w - foot.xy / foot.w) * resolution;
  // Seen from straight above, the stem is a point: any side will do.
  vec2 across = length(along) > 1e-3 ? normalize(vec2(-along.y, along.x)) : vec2(1.0, 0.0);
  vec4 clip = mix(foot, top, corner.y);
  clip.xy += across * corner.x * width * 0.5 * 2.0 / resolution * clip.w;
  gl_Position = clip;
}
`

const headVertex = /* glsl */ `
${pinTop}
uniform float size;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pinTop(), 1.0);
  gl_PointSize = size;
}
`

const headFragment = /* glsl */ `
uniform float size;
uniform float head;
uniform vec3 colour;
uniform vec3 rim;
void main() {
  float d = length(gl_PointCoord - 0.5) * size;
  float outer = clamp(size * 0.5 - d + 0.5, 0.0, 1.0);
  if (outer <= 0.0) {
    discard;
  }
  float inner = clamp(head * 0.5 - d + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(mix(rim, colour, inner), outer);
}
`

/**
 * The pin over this roof; its pixel sizes are measured against `resolution`, which the caller
 * keeps up to date with the drawing buffer.
 */
export function pinParts(
  roof: Vec3,
  resolution: IUniform<Vector2>,
  pixelRatio: number,
): (Mesh | Points)[] {
  const foot: Vec3 = [roof[0], roof[1] + STEM_FROM, roof[2]]
  const stemLength = { value: STEM_LENGTH }
  const stemMinimum = { value: STEM_MINIMUM * pixelRatio }
  const stemGeometry = new BufferGeometry()
  stemGeometry.setAttribute(
    'position',
    new Float32BufferAttribute([...foot, ...foot, ...foot, ...foot], 3),
  )
  stemGeometry.setAttribute('corner', new Float32BufferAttribute([-1, 0, 1, 0, -1, 1, 1, 1], 2))
  stemGeometry.setIndex([0, 1, 2, 2, 1, 3])
  const stemMesh = new Mesh(
    stemGeometry,
    new ShaderMaterial({
      uniforms: {
        resolution,
        stemLength,
        stemMinimum,
        width: { value: STEM_WIDTH * pixelRatio },
        colour: { value: new Vector3(...INK) },
      },
      vertexShader: stemVertex,
      fragmentShader: flatFragment,
      side: DoubleSide,
    }),
  )
  const size = (HEAD + 2 * HEAD_RIM) * pixelRatio
  const headGeometry = new BufferGeometry()
  headGeometry.setAttribute('position', new Float32BufferAttribute(foot, 3))
  const head = new Points(
    headGeometry,
    new ShaderMaterial({
      uniforms: {
        resolution,
        stemLength,
        stemMinimum,
        size: { value: size },
        head: { value: HEAD * pixelRatio },
        colour: { value: new Vector3(...INK) },
        rim: { value: new Vector3(...WHITE) },
      },
      vertexShader: headVertex,
      fragmentShader: headFragment,
      transparent: true,
    }),
  )
  const parts = [stemMesh, head]
  for (const part of parts) {
    part.frustumCulled = false
  }
  return parts
}
