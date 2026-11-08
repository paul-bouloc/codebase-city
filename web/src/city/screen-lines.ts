import {
  BufferGeometry,
  Float32BufferAttribute,
  type IUniform,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'
import type { Vec3 } from './units'

// Lines a fixed number of pixels wide whatever their distance, solid or dashed: each segment is
// a quad its vertex shader widens on screen, a little past its ends so that the segments of a
// polyline join without a notch. Dashes are laid along the line in the scene, so that they follow
// its perspective; their length doubles or halves with the distance, so that on screen they stay
// within √2 of the length asked for. A longer dash starts where a shorter one did: where the length
// changes along a line, the dashes do not jump. (Blending the two lengths fills the gaps half.)

const vertexShader = /* glsl */ `
uniform vec2 resolution;
uniform float width;
attribute vec3 start;
attribute vec3 end;
attribute vec2 corner;
attribute float distance;
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
  vDistance = distance;
  vAcross = corner.y * reach;
}
`

const fragmentShader = /* glsl */ `
uniform vec3 colour;
uniform float width;
uniform float opacity;
uniform vec2 dash;
varying float vDistance;
varying float vAcross;

void main() {
  float cover = clamp(width * 0.5 - abs(vAcross) + 0.5, 0.0, 1.0);
  if (dash.y > 0.0) {
    // The period asked for, in u at this distance, to the nearest power of two.
    float period = exp2(floor(log2((dash.x + dash.y) * max(fwidth(vDistance), 1e-6)) + 0.5));
    cover *= step(fract(vDistance / period), dash.x / (dash.x + dash.y));
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
  /** 1 if absent. */
  opacity?: number
}

/** Polylines, closed or not, in three.js coordinates, drawn a fixed width on screen. */
export function createScreenLines(
  polylines: readonly (readonly Vec3[])[],
  style: LineStyle,
  pixelRatio: number,
  closed = true,
): Mesh {
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
