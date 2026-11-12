import {
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  type IUniform,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'
import { GUIDE } from '../render/palette'
import { OPEN_SEA } from '../terrain/sea'
import type { Rect } from '../world/layout'
import { boardToThree, mixSrgb, srgb } from '../world/units'

// Two rings on the water around each small island the guide shows, so that it can be found from
// afar: they come as the island gets narrower than `SMALL_PIXELS` on screen, and go as it grows,
// smoothly, in the shader.

/** An island narrower than this many CSS pixels on screen gets its rings, */
const SMALL_PIXELS = 42
/** fading in over this many pixels under it. */
const SMALL_FADE = 8
/** The inner ring lies this far past the plateau's corners, in u, */
const RING_OUT = 3.2
/** and never closer to the middle than this many CSS pixels; */
const RING_MINIMUM = 30
/** the outer ring this many CSS pixels past it. */
const RING_GAP = 9
/** Over the water, under the islands. */
const WATER_LIFT = 0.02

const vertexShader = /* glsl */ `
uniform vec2 resolution;
uniform float minimum;
uniform float gap;
uniform vec2 small;
attribute vec3 centre;
attribute float radius;
attribute float extent;
varying vec2 vLocal;
varying float vInner;
varying float vOuter;
varying float vShow;
void main() {
  vec4 middle = viewMatrix * vec4(centre, 1.0);
  float pixelsPerUnit = resolution.y * projectionMatrix[1][1] * 0.5 / max(-middle.z, 1e-3);
  vInner = max(radius, minimum / pixelsPerUnit);
  vOuter = vInner + gap / pixelsPerUnit;
  vShow = 1.0 - smoothstep(small.x, small.y, extent * pixelsPerUnit);
  vec2 local = position.xy * (vOuter + 4.0 / pixelsPerUnit);
  vLocal = local;
  gl_Position = projectionMatrix * viewMatrix * vec4(centre + vec3(local.x, 0.0, -local.y), 1.0);
}
`

const fragmentShader = /* glsl */ `
uniform float innerWidth;
uniform float outerWidth;
uniform vec3 jade;
uniform vec3 innerWater;
uniform vec3 outerWater;
varying vec2 vLocal;
varying float vInner;
varying float vOuter;
varying float vShow;
void main() {
  if (vShow <= 0.0) {
    discard;
  }
  float d = length(vLocal);
  float perPixel = max(fwidth(d), 1e-6);
  float inside = clamp((vInner - d) / perPixel + 0.5, 0.0, 1.0);
  float within = clamp((vOuter - d) / perPixel + 0.5, 0.0, 1.0);
  float innerRing = clamp(innerWidth * 0.5 - abs(d - vInner) / perPixel + 0.5, 0.0, 1.0);
  float outerRing = clamp(outerWidth * 0.5 - abs(d - vOuter) / perPixel + 0.5, 0.0, 1.0);
  vec3 colour = mix(outerWater, innerWater, inside);
  colour = mix(colour, jade, max(innerRing, outerRing));
  float alpha = max(within, outerRing) * vShow;
  if (alpha <= 0.0) {
    discard;
  }
  gl_FragColor = vec4(colour, alpha);
}
`

export class GuideRings {
  readonly group = new Group()
  private readonly resolution: IUniform<Vector2> = { value: new Vector2(1, 1) }

  constructor(private readonly pixelRatio: number) {}

  /** Rings around these plateaux while they are small on screen, or none. */
  show(plateaux: readonly Rect[]): void {
    this.clear()
    if (plateaux.length === 0) {
      return
    }
    const geometry = new InstancedBufferGeometry()
    // A unit square, the rings' local plane: x east, y north.
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3),
    )
    geometry.setIndex([0, 1, 2, 2, 1, 3])
    const centres = plateaux.flatMap(({ x, y, width, height }) =>
      boardToThree(x + width / 2, y + height / 2, WATER_LIFT),
    )
    geometry.setAttribute('centre', new InstancedBufferAttribute(new Float32Array(centres), 3))
    geometry.setAttribute(
      'radius',
      new InstancedBufferAttribute(
        new Float32Array(
          plateaux.map(({ width, height }) => Math.hypot(width, height) / 2 + RING_OUT),
        ),
        1,
      ),
    )
    geometry.setAttribute(
      'extent',
      new InstancedBufferAttribute(
        new Float32Array(plateaux.map(({ width, height }) => Math.max(width, height))),
        1,
      ),
    )
    geometry.instanceCount = plateaux.length
    const ratio = this.pixelRatio
    const material = new ShaderMaterial({
      uniforms: {
        resolution: this.resolution,
        minimum: { value: RING_MINIMUM * ratio },
        gap: { value: RING_GAP * ratio },
        small: {
          value: new Vector2(SMALL_PIXELS - SMALL_FADE, SMALL_PIXELS).multiplyScalar(ratio),
        },
        innerWidth: { value: 2.4 * ratio },
        outerWidth: { value: 1.2 * ratio },
        jade: { value: new Vector3(...srgb(GUIDE)) },
        innerWater: { value: new Vector3(...mixSrgb(OPEN_SEA, '#FFFFFF', 0.45)) },
        outerWater: { value: new Vector3(...mixSrgb(OPEN_SEA, '#FFFFFF', 0.28)) },
      },
      vertexShader,
      fragmentShader,
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
    const mesh = new Mesh(geometry, material)
    mesh.frustumCulled = false
    mesh.onBeforeRender = (renderer) => {
      renderer.getDrawingBufferSize(this.resolution.value)
    }
    this.group.add(mesh)
  }

  dispose(): void {
    this.clear()
  }

  private clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child)
      if (child instanceof Mesh) {
        child.geometry.dispose()
        ;(child.material as ShaderMaterial).dispose()
      }
    }
  }
}
