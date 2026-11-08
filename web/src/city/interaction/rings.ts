import {
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  type IUniform,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'
import type { PlacedBuilding } from '../buildings/placed-buildings'
import { UPWARD } from '../render/palette'
import { srgb, type Vec3 } from '../world/units'
import { INK } from './ink'

// Rings on the ground around buildings, as wide in pixels at any distance and never smaller on
// screen than their least radius: one around a marked building, or many in one draw.

/** The ring's radius around a building of side `side`, in u. */
export const ringRadius = (side: number) => 0.78 * side + 0.25

/** The ring sits a little above the ground it is drawn on. */
const RING_LIFT = 0.03

// The ring grows to its least size on screen when its building is far: its plane scales about
// its middle, by how many pixels a unit spans there.
const ringVertex = /* glsl */ `
uniform float radius;
uniform float minimum;
uniform vec2 resolution;
varying vec2 vLocal;
varying float vRadius;
void main() {
  vec4 middle = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float pixelsPerUnit = resolution.y * projectionMatrix[1][1] * 0.5 / max(-middle.z, 1e-3);
  float grown = max(radius, minimum / pixelsPerUnit);
  vec3 local = vec3(position.xy * grown / radius, position.z);
  vLocal = local.xy;
  vRadius = grown;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(local, 1.0);
}
`

const ringFragment = /* glsl */ `
uniform float width;
uniform vec3 colour;
varying vec2 vLocal;
varying float vRadius;
void main() {
  float radius = vRadius;
  float d = length(vLocal);
  float perPixel = max(fwidth(d), 1e-6);
  float off = abs(d - radius) / perPixel;
  float cover = clamp(width * 0.5 - off + 0.5, 0.0, 1.0);
  if (cover <= 0.0) {
    discard;
  }
  gl_FragColor = vec4(colour, cover);
}
`

// One ring per instance, around its centre on the ground.
const ringsVertex = /* glsl */ `
uniform float minimum;
uniform vec2 resolution;
attribute vec3 centre;
attribute float radius;
varying vec2 vLocal;
varying float vRadius;
void main() {
  vec4 middle = viewMatrix * vec4(centre, 1.0);
  float pixelsPerUnit = resolution.y * projectionMatrix[1][1] * 0.5 / max(-middle.z, 1e-3);
  float grown = max(radius, minimum / pixelsPerUnit);
  // The plane's corners reach a little past the ring, for its width.
  vec2 local = position.xy * (grown + 0.5 + 8.0 / pixelsPerUnit);
  vLocal = local;
  vRadius = grown;
  gl_Position = projectionMatrix * viewMatrix * vec4(centre + vec3(local.x, 0.0, -local.y), 1.0);
}
`

/** Rings alone, around many buildings at once. */
export interface RingStyle {
  /** Width, in CSS pixels. */
  ring: number
  /** The least radius on screen, in CSS pixels. */
  ringMinimum: number
  colour: Vec3
  /** Past the usual radius, in u. */
  outset: number
}

/**
 * The rings of a cycle's files, Coral: a little outside the rings of a link or a selection, so
 * that a file both linked and in the cycle shows both.
 */
export const CYCLE_RINGS: RingStyle = {
  ring: 2,
  ringMinimum: 17,
  colour: srgb(UPWARD),
  outset: 0.45,
}

/** How the ring of one marked building is drawn. */
export interface BuildingRingStyle {
  /** Width, in CSS pixels. */
  ring: number
  /** The least radius on screen, in CSS pixels. */
  ringMinimum: number
  /** Ink if absent. */
  colour?: Vec3
}

/**
 * The ring around one building; its pixel sizes are measured against `resolution`, which the
 * caller keeps up to date with the drawing buffer.
 */
export function buildingRing(
  position: Vec3,
  side: number,
  style: BuildingRingStyle,
  resolution: IUniform<Vector2>,
  pixelRatio: number,
): Mesh {
  const radius = ringRadius(side)
  // Room for the widest ring past its radius.
  const extent = 2 * (radius + 0.5)
  const material = new ShaderMaterial({
    uniforms: {
      radius: { value: radius },
      minimum: { value: style.ringMinimum * pixelRatio },
      resolution,
      width: { value: style.ring * pixelRatio },
      colour: { value: new Vector3(...(style.colour ?? INK)) },
    },
    vertexShader: ringVertex,
    fragmentShader: ringFragment,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  const mesh = new Mesh(new PlaneGeometry(extent, extent), material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(position[0], position[1] + RING_LIFT, position[2])
  mesh.frustumCulled = false
  return mesh
}

/** Rings around many buildings, in one draw: the members of a cycle. */
export class RingSet {
  readonly group = new Group()
  private readonly resolution: IUniform<Vector2> = { value: new Vector2(1, 1) }

  constructor(
    private readonly style: RingStyle,
    private readonly pixelRatio: number,
  ) {
    this.group.visible = false
  }

  /** Rings these buildings, or none. */
  show(placed: readonly PlacedBuilding[]): void {
    this.clear()
    if (placed.length === 0) {
      return
    }
    const geometry = new InstancedBufferGeometry()
    // A unit square, the ring's local plane: x east, y north.
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3),
    )
    geometry.setIndex([0, 1, 2, 2, 1, 3])
    geometry.setAttribute(
      'centre',
      new InstancedBufferAttribute(
        new Float32Array(
          placed.flatMap(({ position }) => [position[0], position[1] + RING_LIFT, position[2]]),
        ),
        3,
      ),
    )
    geometry.setAttribute(
      'radius',
      new InstancedBufferAttribute(
        new Float32Array(
          placed.map(({ building }) => ringRadius(building.side) + this.style.outset),
        ),
        1,
      ),
    )
    geometry.instanceCount = placed.length
    const material = new ShaderMaterial({
      uniforms: {
        minimum: { value: this.style.ringMinimum * this.pixelRatio },
        resolution: this.resolution,
        width: { value: this.style.ring * this.pixelRatio },
        colour: { value: new Vector3(...this.style.colour) },
      },
      vertexShader: ringsVertex,
      fragmentShader: ringFragment,
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
    this.group.visible = true
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
    this.group.visible = false
  }
}
