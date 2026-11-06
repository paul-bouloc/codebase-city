import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  ShaderMaterial,
  Vector2,
} from 'three'
import type { Ferry } from './links'
import { FERRY_WAKE, UPWARD } from './palette'
import { boardToThree, srgb, type Vec3 } from './units'

// A ferry line is a wake painted on the sea: a ribbon as wide as its imports in u, its dashes
// in u, so that it lies in the scene's perspective like the quays and the beaches. From afar it
// never gets thinner than a pixel and a half, and dashes too small to read merge into a line.

/** Just above the sea and the foam (0.02 u). */
const WAKE_ALTITUDE = 0.04
const MIN_PIXELS = 1.5
const DASH = { dash: 1.2, gap: 0.8 }
/** A link that goes up: red, in shorter dashes. */
const UPWARD_DASH = { dash: 0.6, gap: 0.5 }
/** A dash period shorter than this many pixels is drawn as a solid line. */
const SOLID_BELOW = [3, 6] as const
/** A miter longer than this many half-widths is cut: a sharp turn would spike. */
const MAX_MITER = 2

const WHITE = srgb(FERRY_WAKE)
const RED = srgb(UPWARD)

const vertexShader = /* glsl */ `
uniform float viewportHeight;
attribute vec3 across;
attribute float along;
attribute float halfWidth;
attribute vec3 colour;
attribute vec2 dash;
varying float vAlong;
varying vec3 vColour;
varying vec2 vDash;
void main() {
  vec4 centre = modelViewMatrix * vec4(position, 1.0);
  // How many u a pixel covers at this depth.
  float perPixel = 2.0 * max(-centre.z, 1e-3) / (projectionMatrix[1][1] * viewportHeight);
  float reach = max(halfWidth, ${(MIN_PIXELS / 2).toFixed(2)} * perPixel);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position + across * reach, 1.0);
  vAlong = along;
  vColour = colour;
  vDash = dash;
}
`

const fragmentShader = /* glsl */ `
varying float vAlong;
varying vec3 vColour;
varying vec2 vDash;
void main() {
  float period = vDash.x + vDash.y;
  float pixels = period / max(fwidth(vAlong), 1e-5);
  float solid = 1.0 - smoothstep(${SOLID_BELOW[0].toFixed(1)}, ${SOLID_BELOW[1].toFixed(1)}, pixels);
  float on = step(mod(vAlong, period), vDash.x);
  if (max(on, solid) < 0.5) discard;
  gl_FragColor = vec4(vColour, 1.0);
}
`

/** The ribbon of every ferry line, in one draw call. */
export function createFerries(ferries: readonly Ferry[]): Mesh {
  const positions: number[] = []
  const across: number[] = []
  const along: number[] = []
  const halfWidths: number[] = []
  const colours: number[] = []
  const dashes: number[] = []
  const indices: number[] = []
  for (const ferry of ferries) {
    const path = ferry.path
    if (path.length < 2) {
      continue
    }
    const colour = ferry.upward ? RED : WHITE
    const { dash, gap } = ferry.upward ? UPWARD_DASH : DASH
    const half = ferry.width / 2
    let distance = 0
    path.forEach((point, index) => {
      const previous = path[index - 1]
      const next = path[index + 1]
      if (previous) {
        distance += Math.hypot(point.x - previous.x, point.y - previous.y)
      }
      const [nx, ny, scale] = miter(previous ?? point, point, next ?? point)
      const first = positions.length / 3
      for (const side of [-1, 1]) {
        positions.push(...boardToThree(point.x, point.y, WAKE_ALTITUDE))
        const out: Vec3 = boardToThree(side * nx * scale, side * ny * scale, 0)
        across.push(...out)
        along.push(distance)
        halfWidths.push(half)
        colours.push(...colour)
        dashes.push(dash, gap)
      }
      if (index > 0) {
        const a = first - 2
        indices.push(a, a + 1, first, a + 1, first + 1, first)
      }
    })
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('across', new Float32BufferAttribute(across, 3))
  geometry.setAttribute('along', new Float32BufferAttribute(along, 1))
  geometry.setAttribute('halfWidth', new Float32BufferAttribute(halfWidths, 1))
  geometry.setAttribute('colour', new Float32BufferAttribute(colours, 3))
  geometry.setAttribute('dash', new Float32BufferAttribute(dashes, 2))
  geometry.setIndex(indices)
  const uniforms = { viewportHeight: { value: 1 } }
  // Flat on the sea, seen from above whichever way its triangles turn.
  const material = new ShaderMaterial({ uniforms, vertexShader, fragmentShader, side: DoubleSide })
  // Laid on the water: nothing below it to hide, and the foam must not fight it for depth.
  material.depthWrite = false
  const mesh = new Mesh(geometry, material)
  // The minimum width needs the canvas's height in CSS pixels, which follows the window.
  const size = new Vector2()
  mesh.onBeforeRender = (renderer) => {
    uniforms.viewportHeight.value = renderer.getSize(size).y
  }
  return mesh
}

/**
 * The direction a ribbon widens to at a point (left of the way it goes), and how much farther
 * than its half-width: the miter between the segments before and after.
 */
export function miter(
  previous: { x: number; y: number },
  point: { x: number; y: number },
  next: { x: number; y: number },
): [number, number, number] {
  const normal = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    return length > 0 ? [-(b.y - a.y) / length, (b.x - a.x) / length] : null
  }
  const before = normal(previous, point)
  const after = normal(point, next)
  const [ax, ay] = before ?? after ?? [0, 1]
  const [bx, by] = after ?? before ?? [0, 1]
  const sx = (ax ?? 0) + (bx ?? 0)
  const sy = (ay ?? 0) + (by ?? 0)
  const length = Math.hypot(sx, sy)
  if (length < 1e-9) {
    return [ax ?? 0, ay ?? 1, 1]
  }
  const nx = sx / length
  const ny = sy / length
  const cos = nx * (ax ?? 0) + ny * (ay ?? 0)
  return [nx, ny, Math.min(1 / Math.max(cos, 1e-6), MAX_MITER)]
}
