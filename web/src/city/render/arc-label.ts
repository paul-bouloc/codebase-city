import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  type IUniform,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'
import type { Vec3 } from '../world/units'

/** A count over a bundle's hub. */
export interface ArcLabel {
  position: Vec3
  text: string
  /** The colour of its arc: its rim, once hovered. */
  colour: Vec3
  /** Rimmed at all times, not only once hovered. */
  rimmed?: boolean
}

/** The count sits this many CSS pixels above its hub. */
export const LABEL_LIFT = 10
const LABEL_FONT = '600 12px "Space Grotesk", system-ui, sans-serif'
export const LABEL_HEIGHT = 20
/** A hovered count's rim, in CSS pixels. */
const LABEL_RIM = 1.5
const LABEL_PADDING = 7
const LABEL_TEXT = '#23313A'

const labelVertex = /* glsl */ `
uniform vec2 resolution;
uniform vec2 size;
uniform float lift;
attribute vec2 corner;
varying vec2 vUv;
void main() {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec2 offset = vec2((corner.x - 0.5) * size.x, corner.y * size.y + lift);
  clip.xy += offset * 2.0 / resolution * clip.w;
  gl_Position = clip;
  vUv = corner;
}
`

// The pill and its count come from the canvas; its rim, in the arc's colour, shows on hover.
const labelFragment = /* glsl */ `
uniform sampler2D map;
uniform vec2 size;
uniform float rim;
uniform vec3 rimColour;
uniform float hovered;
varying vec2 vUv;
void main() {
  vec4 texel = texture2D(map, vUv);
  vec2 halfSize = size * 0.5 - 0.5;
  float radius = halfSize.y;
  vec2 q = abs((vUv - 0.5) * size) - (halfSize - radius);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  float band = clamp(0.5 - d, 0.0, 1.0) * clamp(d + rim + 0.5, 0.0, 1.0) * hovered;
  vec4 colour = mix(texel, vec4(rimColour, 1.0), band);
  if (colour.a <= 0.0) {
    discard;
  }
  gl_FragColor = colour;
}
`

/** A pill with the count, drawn on a canvas, a fixed size on screen above its hub. */
export function labelMesh(
  { position, text, colour, rimmed }: ArcLabel,
  ratio: number,
  resolution: IUniform<Vector2>,
): Mesh {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  let width = LABEL_HEIGHT
  if (context) {
    context.font = LABEL_FONT
    width = Math.ceil(context.measureText(text).width) + 2 * LABEL_PADDING
  }
  canvas.width = Math.ceil(width * ratio)
  canvas.height = Math.ceil(LABEL_HEIGHT * ratio)
  if (context) {
    context.scale(ratio, ratio)
    context.fillStyle = 'rgba(255, 255, 255, 0.92)'
    context.beginPath()
    context.roundRect(0.5, 0.5, width - 1, LABEL_HEIGHT - 1, LABEL_HEIGHT / 2)
    context.fill()
    context.font = LABEL_FONT
    context.fillStyle = LABEL_TEXT
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(text, width / 2, LABEL_HEIGHT / 2 + 0.5)
  }
  const texture = new CanvasTexture(canvas)
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([...position, ...position, ...position, ...position], 3),
  )
  geometry.setAttribute('corner', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2))
  geometry.setIndex([0, 1, 2, 2, 1, 3])
  return new Mesh(
    geometry,
    new ShaderMaterial({
      uniforms: {
        resolution,
        size: { value: new Vector2(canvas.width, canvas.height) },
        lift: { value: LABEL_LIFT * ratio },
        map: { value: texture },
        rim: { value: LABEL_RIM * ratio },
        rimColour: { value: new Vector3(...colour) },
        hovered: { value: rimmed ? 1 : 0 },
      },
      vertexShader: labelVertex,
      fragmentShader: labelFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  )
}

/** Lets go of the texture a label's material draws, made by `labelMesh`; other materials hold none. */
export function disposeLabelTexture(material: ShaderMaterial): void {
  const map = material.uniforms.map?.value
  if (map instanceof CanvasTexture) {
    map.dispose()
  }
}
