import {
  AlwaysStencilFunc,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  type IUniform,
  KeepStencilOp,
  Mesh,
  NotEqualStencilFunc,
  PlaneGeometry,
  Points,
  ReplaceStencilOp,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'
import { buildingGeometry, type Vertex } from './archetype-geometry'
import type { Building } from './archetypes'
import { INCOMING_LINK, OUTGOING_LINK, UPWARD } from './palette'
import type { PlacedBuilding } from './placed-buildings'
import { srgb, type Vec3 } from './world/units'

// What marks one building: an outline around its shape, a ring on the ground and, once
// selected, a pin above its roof. All keep their width in pixels at any distance.

export const INK = srgb('#23313A')
const WHITE = srgb('#FFFFFF')

/** The ring's radius around a building of side `side`, in u. */
export const ringRadius = (side: number) => 0.78 * side + 0.25

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

/** The ring sits a little above the ground it is drawn on. */
const RING_LIFT = 0.03
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

const flatFragment = /* glsl */ `
uniform vec3 colour;
void main() {
  gl_FragColor = vec4(colour, 1.0);
}
`

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
    const radius = ringRadius(side)
    // Room for the widest ring past its radius.
    const extent = 2 * (radius + 0.5)
    const material = new ShaderMaterial({
      uniforms: {
        radius: { value: radius },
        minimum: { value: this.style.ringMinimum * this.pixelRatio },
        resolution: this.resolution,
        width: { value: this.style.ring * this.pixelRatio },
        colour: { value: new Vector3(...(this.style.colour ?? INK)) },
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
    this.follow(mesh)
    return mesh
  }

  private pin(roof: Vec3): (Mesh | Points)[] {
    const foot: Vec3 = [roof[0], roof[1] + STEM_FROM, roof[2]]
    const stemLength = { value: STEM_LENGTH }
    const stemMinimum = { value: STEM_MINIMUM * this.pixelRatio }
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
          resolution: this.resolution,
          stemLength,
          stemMinimum,
          width: { value: STEM_WIDTH * this.pixelRatio },
          colour: { value: new Vector3(...INK) },
        },
        vertexShader: stemVertex,
        fragmentShader: flatFragment,
        side: DoubleSide,
      }),
    )
    const size = (HEAD + 2 * HEAD_RIM) * this.pixelRatio
    const headGeometry = new BufferGeometry()
    headGeometry.setAttribute('position', new Float32BufferAttribute(foot, 3))
    const head = new Points(
      headGeometry,
      new ShaderMaterial({
        uniforms: {
          resolution: this.resolution,
          stemLength,
          stemMinimum,
          size: { value: size },
          head: { value: HEAD * this.pixelRatio },
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
      this.follow(part)
    }
    return parts
  }
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
