import {
  AlwaysStencilFunc,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  type IUniform,
  KeepStencilOp,
  Mesh,
  NotEqualStencilFunc,
  Points,
  ReplaceStencilOp,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'
import { buildingGeometry, type Vertex } from '../buildings/archetype-geometry'
import type { Building } from '../buildings/archetypes'
import type { PlacedBuilding } from '../buildings/placed-buildings'
import { INCOMING_LINK, OUTGOING_LINK } from '../render/palette'
import { srgb, type Vec3 } from '../world/units'
import { flatFragment, INK } from './ink'
import { pinParts } from './pin'
import { buildingRing } from './rings'

// What marks one building: an outline around its shape, a ring on the ground and, once
// selected, a pin above its roof. All keep their width in pixels at any distance.

/** How high a building's roof rises above its foot, chimneys and all, in u. */
export function roofHeight(building: Building): number {
  return topOf(buildingGeometry(building).flat(), building)
}

function topOf(vertices: readonly Vertex[], building: Building): number {
  let top = 0
  for (const { position: p, sideFactor: s, heightFactor: h } of vertices) {
    top = Math.max(
      top,
      p[1] + s[1] * building.side + h[0] * building.height + h[1] * building.split,
    )
  }
  return top
}

/** How a building is marked. */
export interface MarkStyle {
  /** Outline width, in CSS pixels. */
  outline: number
  /** Ring width, in CSS pixels. */
  ring: number
  /** The ring's least radius on screen, in CSS pixels: a far building still gets a clear one. */
  ringMinimum: number
  pin: boolean
  /** Of the outline and the ring; ink if absent. */
  colour?: Vec3
}

export const HOVERED_MARK: MarkStyle = { outline: 2, ring: 1.5, ringMinimum: 12, pin: false }
export const SELECTED_MARK: MarkStyle = { outline: 2.5, ring: 3, ringMinimum: 16, pin: true }
/** A file linked to the selection: Marine if the selection imports it, Sun if it imports it. */
export const OUTGOING_MARK: MarkStyle = {
  outline: 2,
  ring: 2,
  ringMinimum: 12,
  pin: false,
  colour: srgb(OUTGOING_LINK),
}
export const INCOMING_MARK: MarkStyle = { ...OUTGOING_MARK, colour: srgb(INCOMING_LINK) }

/** Drawn after the city, over whatever stands in front. */
const OUTLINE_ORDER = 8

// The outline goes around the building's whole silhouette, over whatever stands in front: the
// building first marks its silhouette in the stencil, then copies of it shifted a few pixels all
// around draw the ink, outside the silhouette only. Any shape gets an even band.
const outlineVertex = /* glsl */ `
uniform vec3 building;
uniform vec2 resolution;
uniform float width;
attribute vec3 sideFactor;
attribute vec2 heightFactor;
attribute vec2 shift;
void main() {
  vec3 stretched = position + sideFactor * building.x;
  stretched.y += dot(heightFactor, building.yz);
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(stretched, 1.0);
  clip.xy += shift * width * 2.0 / resolution * clip.w;
  gl_Position = clip;
}
`

/** Directions the copies are shifted in: the band's corners are this many-sided. */
const OUTLINE_SHIFTS = 12

/** The marks of one building at a time: hovered or selected. */
export class BuildingMark {
  readonly group = new Group()
  private readonly resolution: IUniform<Vector2> = { value: new Vector2(1, 1) }

  constructor(
    private readonly style: MarkStyle,
    private readonly pixelRatio: number,
  ) {
    this.group.visible = false
  }

  /** Marks this building, or none. */
  show(placed: PlacedBuilding | null): void {
    this.clear()
    if (!placed) {
      return
    }
    const { building, position } = placed
    const vertices = buildingGeometry(building).flat()
    const top = topOf(vertices, building)
    this.group.add(...this.outline(placed, vertices), this.ring(position, building.side))
    if (this.style.pin) {
      this.group.add(...this.pin([position[0], position[1] + top, position[2]]))
    }
    this.group.visible = true
  }

  dispose(): void {
    this.clear()
  }

  private clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child)
      if (child instanceof Mesh || child instanceof Points) {
        child.geometry.dispose()
        ;(child.material as ShaderMaterial).dispose()
      }
    }
    this.group.visible = false
  }

  /** Keeps the drawing buffer's size, which the pixel widths are measured against. */
  private follow(object: Mesh | Points): void {
    object.onBeforeRender = (renderer) => {
      renderer.getDrawingBufferSize(this.resolution.value)
    }
  }

  /** The silhouette in the stencil, then the band of ink around it. */
  private outline({ building, position, angle }: PlacedBuilding, vertices: readonly Vertex[]) {
    const geometry = new InstancedBufferGeometry()
    const attribute = (name: 'position' | 'sideFactor' | 'heightFactor') => {
      const values = vertices.flatMap((vertex) => vertex[name])
      geometry.setAttribute(
        name,
        new Float32BufferAttribute(values, values.length / vertices.length),
      )
    }
    attribute('position')
    attribute('sideFactor')
    attribute('heightFactor')
    // The first copy stays in place: it is the silhouette.
    const shifts = [0, 0]
    for (let at = 0; at < OUTLINE_SHIFTS; at++) {
      const turn = (at / OUTLINE_SHIFTS) * 2 * Math.PI
      shifts.push(Math.cos(turn), Math.sin(turn))
    }
    geometry.setAttribute('shift', new InstancedBufferAttribute(new Float32Array(shifts), 2))
    const uniforms = {
      building: { value: new Vector3(building.side, building.height, building.split) },
      resolution: this.resolution,
      width: { value: this.style.outline * this.pixelRatio },
      colour: { value: new Vector3(...(this.style.colour ?? INK)) },
    }
    const common = {
      uniforms,
      vertexShader: outlineVertex,
      fragmentShader: flatFragment,
      side: DoubleSide,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      stencilWrite: true,
      stencilRef: 1,
    }
    const silhouette = new ShaderMaterial({
      ...common,
      colorWrite: false,
      stencilFunc: AlwaysStencilFunc,
      stencilZPass: ReplaceStencilOp,
    })
    const ink = new ShaderMaterial({
      ...common,
      stencilFunc: NotEqualStencilFunc,
      stencilZPass: KeepStencilOp,
    })
    const mask = new Mesh(geometry.clone(), silhouette)
    ;(mask.geometry as InstancedBufferGeometry).instanceCount = 1
    geometry.instanceCount = OUTLINE_SHIFTS + 1
    const band = new Mesh(geometry, ink)
    mask.renderOrder = OUTLINE_ORDER
    band.renderOrder = OUTLINE_ORDER + 1
    for (const mesh of [mask, band]) {
      mesh.position.set(...position)
      mesh.rotation.y = angle
      mesh.frustumCulled = false
      this.follow(mesh)
    }
    return [mask, band]
  }

  private ring(position: Vec3, side: number): Mesh {
    const mesh = buildingRing(position, side, this.style, this.resolution, this.pixelRatio)
    this.follow(mesh)
    return mesh
  }

  private pin(roof: Vec3): (Mesh | Points)[] {
    const parts = pinParts(roof, this.resolution, this.pixelRatio)
    for (const part of parts) {
      this.follow(part)
    }
    return parts
  }
}
