import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  LinearFilter,
  Mesh,
  ShaderMaterial,
  Vector2,
} from 'three'
import type { Vec3 } from '../world/units'

// A pill of text over the city, drawn in the city's own frame: a quad a fixed size on screen,
// beside a point of the world, its texture drawn on a canvas. Drawn by WebGL rather than as HTML,
// it never parts from the city as the camera moves.

/** A line of text in a pill, from the top: its CSS font, colour and line height in CSS pixels. */
export interface PillLine {
  text: string
  font: string
  colour: string
  height: number
}

/** How a pill looks, in CSS pixels. */
export interface PillStyle {
  fill: string
  radius: number
  padding: { across: number; down: number }
  /** A rim inside its edge, if any. */
  rim?: { colour: string; width: number }
  /** A shadow under it, if any: the quad grows by `margin` around the pill to hold it. */
  shadow?: { colour: string; blur: number; down: number; margin: number }
}

/** The texture of a pill and its size, in device pixels, its margin included. */
export interface PillTexture {
  texture: CanvasTexture
  width: number
  height: number
  /** The margin around the pill, in device pixels. */
  margin: number
}

/** Draws a pill of these lines, `width` CSS pixels wide, at `ratio` device pixels a CSS pixel. */
export function drawPill(
  lines: readonly PillLine[],
  width: number,
  style: PillStyle,
  ratio: number,
): PillTexture {
  const margin = style.shadow?.margin ?? 0
  const height = lines.reduce((sum, line) => sum + line.height, 0) + 2 * style.padding.down
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil((width + 2 * margin) * ratio)
  canvas.height = Math.ceil((height + 2 * margin) * ratio)
  const context = canvas.getContext('2d')
  if (context) {
    context.scale(ratio, ratio)
    context.translate(margin, margin)
    const radius = Math.min(style.radius, height / 2)
    context.beginPath()
    context.roundRect(0, 0, width, height, radius)
    if (style.shadow) {
      context.shadowColor = style.shadow.colour
      context.shadowBlur = style.shadow.blur
      context.shadowOffsetY = style.shadow.down
    }
    context.fillStyle = style.fill
    context.fill()
    context.shadowColor = 'transparent'
    if (style.rim) {
      const inset = style.rim.width / 2
      context.beginPath()
      context.roundRect(inset, inset, width - 2 * inset, height - 2 * inset, radius - inset)
      context.lineWidth = style.rim.width
      context.strokeStyle = style.rim.colour
      context.stroke()
    }
    context.textBaseline = 'middle'
    let top = style.padding.down
    for (const line of lines) {
      context.font = line.font
      context.fillStyle = line.colour
      context.fillText(line.text, style.padding.across, top + line.height / 2)
      top += line.height
    }
  }
  const texture = new CanvasTexture(canvas)
  texture.generateMipmaps = false
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  return { texture, width: canvas.width, height: canvas.height, margin: Math.round(margin * ratio) }
}

const pillVertex = /* glsl */ `
uniform vec2 resolution;
uniform vec2 size;
uniform vec2 offset;
uniform float snap;
attribute vec2 corner;
varying vec2 vUv;
void main() {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // The anchor on screen, in device pixels from the top left; on a whole pixel at rest.
  vec2 ndc = clip.xy / clip.w;
  vec2 pixel = vec2((ndc.x * 0.5 + 0.5) * resolution.x, (0.5 - ndc.y * 0.5) * resolution.y);
  pixel = mix(pixel, floor(pixel + 0.5), snap);
  vec2 at = pixel + offset + corner * size;
  vec2 placed = vec2(at.x / resolution.x * 2.0 - 1.0, 1.0 - at.y / resolution.y * 2.0);
  gl_Position = vec4(placed * clip.w, clip.z, clip.w);
  vUv = vec2(corner.x, 1.0 - corner.y);
}
`

const pillFragment = /* glsl */ `
uniform sampler2D map;
uniform float opacity;
varying vec2 vUv;
void main() {
  vec4 texel = texture2D(map, vUv);
  float alpha = texel.a * opacity;
  if (alpha <= 0.0) {
    discard;
  }
  gl_FragColor = vec4(texel.rgb, alpha);
}
`

/**
 * A quad showing `pill` beside `anchor`, over everything else. Its offset, from the anchor to
 * the pill's top left corner in device pixels, its snapping to whole pixels and its opacity are
 * set through `setPill`.
 */
export function pillMesh(anchor: Vec3, pill: PillTexture): Mesh {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([...anchor, ...anchor, ...anchor, ...anchor], 3),
  )
  geometry.setAttribute('corner', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2))
  geometry.setIndex([0, 2, 1, 1, 2, 3])
  const resolution = { value: new Vector2(1, 1) }
  const mesh = new Mesh(
    geometry,
    new ShaderMaterial({
      uniforms: {
        resolution,
        size: { value: new Vector2(pill.width, pill.height) },
        offset: { value: new Vector2(0, 0) },
        snap: { value: 0 },
        opacity: { value: 0 },
        map: { value: pill.texture },
      },
      vertexShader: pillVertex,
      fragmentShader: pillFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  )
  mesh.frustumCulled = false
  mesh.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(resolution.value)
  }
  return mesh
}

/** Places a pill's quad: its top left `x`, `y` device pixels from the anchor, as `pillMesh` says. */
export function setPill(
  mesh: Mesh,
  { x, y, snap, opacity }: { x: number; y: number; snap: boolean; opacity: number },
): void {
  const { uniforms } = mesh.material as ShaderMaterial
  uniforms.offset?.value.set(x, y)
  if (uniforms.snap) {
    uniforms.snap.value = snap ? 1 : 0
  }
  if (uniforms.opacity) {
    uniforms.opacity.value = opacity
  }
}

/** Lets go of a pill's quad, its material and its texture. */
export function disposePill(mesh: Mesh): void {
  mesh.geometry.dispose()
  const material = mesh.material as ShaderMaterial
  material.uniforms.map?.value.dispose()
  material.dispose()
}
