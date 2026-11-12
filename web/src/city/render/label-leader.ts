import {
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'
import type { Vec3 } from '../world/units'

// The leader line of a label: from a point of the world, marked by a dot, to the label's pill,
// a line on a white band. The pill stands beside its own anchor, a fixed offset away on screen:
// the line reaches it wherever the camera goes, as the pill does.

/** How a leader looks, in CSS pixels. */
export interface LeaderStyle {
  colour: Vec3
  width: number
  /** The white band under the line, and how opaque it is. */
  halo: { width: number; opacity: number }
  /** The dot at the world's end, and the white rim around it. */
  dot: { radius: number; rim: number }
}

const vertexShader = /* glsl */ `
uniform vec2 resolution;
uniform vec3 anchor;
uniform vec2 offset;
uniform float reach;
attribute vec2 corner;
varying vec2 vLocal;
varying float vLength;
vec2 onScreen(vec4 clip) {
  vec2 ndc = clip.xy / clip.w;
  return vec2((ndc.x * 0.5 + 0.5) * resolution.x, (0.5 - ndc.y * 0.5) * resolution.y);
}
void main() {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec2 start = onScreen(clip);
  vec2 end = onScreen(projectionMatrix * viewMatrix * vec4(anchor, 1.0)) + offset;
  vec2 line = end - start;
  float span = max(length(line), 1e-3);
  vec2 along = line / span;
  vec2 across = vec2(-along.y, along.x);
  // From before the dot to the pill, as wide as the dot.
  vLocal = vec2(mix(-reach, span, corner.x), corner.y * reach);
  vLength = span;
  vec2 at = start + along * vLocal.x + across * vLocal.y;
  vec2 placed = vec2(at.x / resolution.x * 2.0 - 1.0, 1.0 - at.y / resolution.y * 2.0);
  gl_Position = vec4(placed * clip.w, clip.z, clip.w);
}
`

const fragmentShader = /* glsl */ `
uniform vec3 colour;
uniform float width;
uniform float haloWidth;
uniform float haloOpacity;
uniform float radius;
uniform float rim;
uniform float opacity;
varying vec2 vLocal;
varying float vLength;
void main() {
  float off = length(vec2(vLocal.x - clamp(vLocal.x, 0.0, vLength), vLocal.y));
  float halo = clamp(haloWidth * 0.5 - off + 0.5, 0.0, 1.0) * haloOpacity;
  float line = clamp(width * 0.5 - off + 0.5, 0.0, 1.0);
  float d = length(vLocal);
  float ring = clamp(radius + rim - d + 0.5, 0.0, 1.0);
  float fill = clamp(radius - d + 0.5, 0.0, 1.0);
  vec3 white = vec3(1.0);
  vec3 tint = mix(white, colour, line);
  float alpha = max(halo, line);
  tint = mix(tint, white, ring);
  alpha = max(alpha, ring);
  tint = mix(tint, colour, fill);
  alpha *= opacity;
  if (alpha <= 0.0) {
    discard;
  }
  gl_FragColor = vec4(tint, alpha);
}
`

/**
 * A leader from `from` to the pill of the label anchored at `anchor`; where it ends on the pill,
 * and its opacity, are set through `setLeader`.
 */
export function leaderMesh(from: Vec3, anchor: Vec3, style: LeaderStyle, ratio: number): Mesh {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([...from, ...from, ...from, ...from], 3),
  )
  geometry.setAttribute('corner', new Float32BufferAttribute([0, -1, 1, -1, 0, 1, 1, 1], 2))
  geometry.setIndex([0, 2, 1, 1, 2, 3])
  const resolution = { value: new Vector2(1, 1) }
  const reach = (Math.max(style.dot.radius + style.dot.rim, style.halo.width / 2) + 1) * ratio
  const mesh = new Mesh(
    geometry,
    new ShaderMaterial({
      uniforms: {
        resolution,
        anchor: { value: new Vector3(...anchor) },
        offset: { value: new Vector2(0, 0) },
        reach: { value: reach },
        colour: { value: new Vector3(...style.colour) },
        width: { value: style.width * ratio },
        haloWidth: { value: style.halo.width * ratio },
        haloOpacity: { value: style.halo.opacity },
        radius: { value: style.dot.radius * ratio },
        rim: { value: style.dot.rim * ratio },
        opacity: { value: 0 },
      },
      vertexShader,
      fragmentShader,
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

/** Where a leader ends: `x`, `y` device pixels from its label's anchor on screen. */
export function setLeader(
  mesh: Mesh,
  { x, y, opacity }: { x: number; y: number; opacity: number },
): void {
  const { uniforms } = mesh.material as ShaderMaterial
  uniforms.offset?.value.set(x, y)
  if (uniforms.opacity) {
    uniforms.opacity.value = opacity
  }
}

/** Lets go of a leader's geometry and material. */
export function disposeLeader(mesh: Mesh): void {
  mesh.geometry.dispose()
  ;(mesh.material as ShaderMaterial).dispose()
}
