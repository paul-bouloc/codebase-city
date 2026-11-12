import {
  BufferGeometry,
  Float32BufferAttribute,
  type IUniform,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'
import type { Vec3 } from '../world/units'

// Lines a fixed number of pixels wide whatever their distance, solid or dashed in pixels: each
// segment is a quad its vertex shader widens on screen, a little past its ends so that the
// segments of a polyline join without a notch.

const vertexShader = /* glsl */ `
uniform vec2 resolution;
uniform float width;
attribute vec3 start;
attribute vec3 end;
attribute vec2 corner;
attribute float distance;
varying float vPixels;
varying float vDistance;
varying float vAcross;
void main() {
  vec4 a = projectionMatrix * modelViewMatrix * vec4(start, 1.0);
  vec4 b = projectionMatrix * modelViewMatrix * vec4(end, 1.0);
  vec4 here = corner.x < 0.5 ? a : b;
  vec2 along = normalize((b.xy / b.w - a.xy / a.w) * resolution + 1e-6);
  vec2 normal = vec2(-along.y, along.x);
  float reach = width * 0.5 + 0.5;
  vec2 offset = (normal * corner.y * reach + along * (corner.x * 2.0 - 1.0) * reach) / resolution;
  gl_Position = here + vec4(offset * 2.0 * here.w, 0.0, 0.0);
  // How many pixels one unit spans here: dashes keep their length in pixels.
  float unitPixels = projectionMatrix[1][1] * 0.5 * resolution.y / max(here.w, 1e-3);
  vPixels = distance * unitPixels;
  vDistance = distance;
  vAcross = corner.y * reach;
}
`

/** A scene dash period shorter than this many device pixels fills in, from the first to the second. */
const SOLID_BELOW = [6, 12] as const

const fragmentShader = /* glsl */ `
uniform vec3 colour;
uniform float width;
uniform float opacity;
uniform vec2 dash;
uniform vec2 sceneDash;
uniform float dots;
varying float vPixels;
varying float vDistance;
varying float vAcross;
void main() {
  float cover = clamp(width * 0.5 - abs(vAcross) + 0.5, 0.0, 1.0);
  if (dots > 0.0) {
    // Round dots as wide as the line, one every so many pixels, the first on its start.
    float along = mod(vPixels + dots * 0.5, dots) - dots * 0.5;
    cover = clamp(width * 0.5 - length(vec2(along, vAcross)) + 0.5, 0.0, 1.0);
  }
  if (dash.y > 0.0 && mod(vPixels, dash.x + dash.y) > dash.x) {
    discard;
  }
  if (sceneDash.y > 0.0) {
    // Painted on the scene: from afar, once a dash and its gap span too few pixels to read, the
    // gaps fill in, gradually.
    float period = sceneDash.x + sceneDash.y;
    float pixels = period / max(fwidth(vDistance), 1e-6);
    float solid = 1.0 - smoothstep(${SOLID_BELOW[0].toFixed(1)}, ${SOLID_BELOW[1].toFixed(1)}, pixels);
    cover *= max(step(mod(vDistance, period), sceneDash.x), solid);
  }
  if (cover <= 0.0) {
    discard;
  }
  gl_FragColor = vec4(colour, opacity * cover);
}
`

export interface LineStyle {
  /** In CSS pixels. */
  width: number
  /** sRGB, as the city's shaders work. */
  colour: Vec3
  /** Dash and gap, in CSS pixels; solid if absent. */
  dash?: [number, number]
  /**
   * Dash and gap along the line in the scene, in u: they follow its perspective, like paint.
   * Used instead of `dash`.
   */
  sceneDash?: [number, number]
  /** Round dots as wide as the line, this many CSS pixels apart, instead of a line. */
  dots?: number
  /** 1 if absent. */
  opacity?: number
}

/**
 * The quads of polylines, closed or not, for a screen-line shader: each segment's ends, its
 * corner (which end, which side) and how far along its line each corner is, in u. Every polyline
 * gives `4 × segments` vertices, in order.
 */
export function lineGeometry(
  polylines: readonly (readonly Vec3[])[],
  closed: boolean,
): BufferGeometry {
  const starts: number[] = []
  const ends: number[] = []
  const corners: number[] = []
  const distances: number[] = []
  const indices: number[] = []
  for (const points of polylines) {
    let travelled = 0
    const count = closed ? points.length : points.length - 1
    for (let i = 0; i < count; i++) {
      const a = points[i] as Vec3
      const b = points[(i + 1) % points.length] as Vec3
      const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
      const first = corners.length / 2
      for (const [x, y] of [
        [0, -1],
        [0, 1],
        [1, -1],
        [1, 1],
      ] as const) {
        starts.push(...a)
        ends.push(...b)
        corners.push(x, y)
        distances.push(travelled + x * length)
      }
      indices.push(first, first + 2, first + 1, first + 1, first + 2, first + 3)
      travelled += length
    }
  }
  const geometry = new BufferGeometry()
  // three.js needs a position to draw; the shader reads the ends instead.
  geometry.setAttribute('position', new Float32BufferAttribute(starts, 3))
  geometry.setAttribute('start', new Float32BufferAttribute(starts, 3))
  geometry.setAttribute('end', new Float32BufferAttribute(ends, 3))
  geometry.setAttribute('corner', new Float32BufferAttribute(corners, 2))
  geometry.setAttribute('distance', new Float32BufferAttribute(distances, 1))
  geometry.setIndex(indices)
  return geometry
}

/** Polylines, closed or not, in three.js coordinates, drawn a fixed width on screen. */
export function createScreenLines(
  polylines: readonly (readonly Vec3[])[],
  style: LineStyle,
  pixelRatio: number,
  closed = true,
): Mesh {
  const geometry = lineGeometry(polylines, closed)

  const resolution: IUniform<Vector2> = { value: new Vector2(1, 1) }
  const material = new ShaderMaterial({
    uniforms: {
      resolution,
      width: { value: style.width * pixelRatio },
      colour: { value: new Vector3(...style.colour) },
      opacity: { value: style.opacity ?? 1 },
      dash: {
        value: new Vector2(...(style.dash ?? [0, 0]).map((length) => length * pixelRatio)),
      },
      sceneDash: { value: new Vector2(...(style.sceneDash ?? [0, 0])) },
      dots: { value: (style.dots ?? 0) * pixelRatio },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
  })
  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(resolution.value)
  }
  return mesh
}
