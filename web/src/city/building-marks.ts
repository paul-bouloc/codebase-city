import {
  BackSide,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  type IUniform,
  Mesh,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'
import { buildingGeometry, type Vertex } from './archetype-geometry'
import type { PlacedBuilding } from './placed-buildings'
import { srgb, type Vec3 } from './units'

// What marks one building: an outline around its shape, a ring on the ground and, once
// selected, a pin above its roof. All keep their width in pixels at any distance.

export const INK = srgb('#23313A')
const WHITE = srgb('#FFFFFF')

/** The ring's radius around a building of side `side`, in u. */
export const ringRadius = (side: number) => 0.78 * side + 0.25

/** How a building is marked. */
export interface MarkStyle {
  /** Outline width, in CSS pixels. */
  outline: number
  /** Ring width, and its dash and gap if dotted, in CSS pixels. */
  ring: number
  ringDash?: [number, number]
  /** The ring's least radius on screen, in CSS pixels: a far building still gets a clear one. */
  ringMinimum: number
  pin: boolean
}

export const HOVERED_MARK: MarkStyle = {
  outline: 2,
  ring: 1.5,
  ringDash: [4, 3],
  ringMinimum: 12,
  pin: false,
}
export const SELECTED_MARK: MarkStyle = { outline: 2.5, ring: 3, ringMinimum: 16, pin: true }

/** The ring sits a little above the ground it is drawn on. */
const RING_LIFT = 0.03
/**
 * The pin stands above the roof, from this far over it in u; its stem is as long on screen at
 * any distance, in CSS pixels, then its head and the head's white rim.
 */
const STEM_FROM = 0.4
const STEM_LENGTH = 36
const STEM_WIDTH = 2
const HEAD = 12
const HEAD_RIM = 2.5
/** Drawn after the city, over whatever stands in front. */
const PIN_ORDER = 10

// The outline is the shape's back faces, each vertex pushed away from the building's middle on
// screen: a shell a fixed number of pixels wider than the building, seen only past its edge.
const outlineVertex = /* glsl */ `
uniform vec3 building;
uniform vec3 middle;
uniform vec2 resolution;
uniform float width;
attribute vec3 sideFactor;
attribute vec2 heightFactor;
void main() {
  vec3 stretched = position + sideFactor * building.x;
  stretched.y += dot(heightFactor, building.yz);
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(stretched, 1.0);
  vec4 centre = projectionMatrix * modelViewMatrix * vec4(middle, 1.0);
  vec2 away = (clip.xy / clip.w - centre.xy / centre.w) * resolution;
  vec2 push = length(away) > 1e-4 ? normalize(away) : vec2(0.0);
  clip.xy += push * width * 2.0 / resolution * clip.w;
  gl_Position = clip;
}
`

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
uniform vec2 dash;
uniform vec3 colour;
varying vec2 vLocal;
varying float vRadius;
void main() {
  float radius = vRadius;
  float d = length(vLocal);
  float perPixel = max(fwidth(d), 1e-6);
  float off = abs(d - radius) / perPixel;
  float cover = clamp(width * 0.5 - off + 0.5, 0.0, 1.0);
  if (dash.y > 0.0) {
    float around = (atan(vLocal.y, vLocal.x) + 3.14159265) * radius / perPixel;
    if (mod(around, dash.x + dash.y) > dash.x) {
      discard;
    }
  }
  if (cover <= 0.0) {
    discard;
  }
  gl_FragColor = vec4(colour, cover);
}
`

// The stem is a quad standing up from its foot on screen: `corner` is its side (−1 or 1) and
// how far up it is (0 or 1). The head sits at its top.
const stemVertex = /* glsl */ `
uniform vec2 resolution;
uniform float width;
uniform float stem;
attribute vec2 corner;
void main() {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  clip.xy += vec2(corner.x * width * 0.5, corner.y * stem) * 2.0 / resolution * clip.w;
  gl_Position = clip;
}
`

const headVertex = /* glsl */ `
uniform vec2 resolution;
uniform float stem;
uniform float size;
void main() {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  clip.y += stem * 2.0 / resolution.y * clip.w;
  gl_Position = clip;
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
    let top = 0
    for (const { position: p, sideFactor: s, heightFactor: h } of vertices) {
      top = Math.max(
        top,
        p[1] + s[1] * building.side + h[0] * building.height + h[1] * building.split,
      )
    }
    this.group.add(this.outline(placed, vertices, top), this.ring(position, building.side))
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

  private outline(
    { building, position, angle }: PlacedBuilding,
    vertices: readonly Vertex[],
    top: number,
  ): Mesh {
    const geometry = new BufferGeometry()
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
    const material = new ShaderMaterial({
      uniforms: {
        building: { value: new Vector3(building.side, building.height, building.split) },
        middle: { value: new Vector3(0, top / 2, 0) },
        resolution: this.resolution,
        width: { value: this.style.outline * this.pixelRatio },
        colour: { value: new Vector3(...INK) },
      },
      vertexShader: outlineVertex,
      fragmentShader: flatFragment,
      side: BackSide,
    })
    const mesh = new Mesh(geometry, material)
    mesh.position.set(...position)
    mesh.rotation.y = angle
    mesh.frustumCulled = false
    this.follow(mesh)
    return mesh
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
        dash: {
          value: new Vector2(...(this.style.ringDash ?? [0, 0]).map((l) => l * this.pixelRatio)),
        },
        colour: { value: new Vector3(...INK) },
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
    const length = { value: STEM_LENGTH * this.pixelRatio }
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
          width: { value: STEM_WIDTH * this.pixelRatio },
          stem: length,
          colour: { value: new Vector3(...INK) },
        },
        vertexShader: stemVertex,
        fragmentShader: flatFragment,
        depthTest: false,
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
          stem: length,
          size: { value: size },
          head: { value: HEAD * this.pixelRatio },
          colour: { value: new Vector3(...INK) },
          rim: { value: new Vector3(...WHITE) },
        },
        vertexShader: headVertex,
        fragmentShader: headFragment,
        transparent: true,
        depthTest: false,
      }),
    )
    const parts = [stemMesh, head]
    for (const part of parts) {
      part.frustumCulled = false
      part.renderOrder = PIN_ORDER
      this.follow(part)
    }
    return parts
  }
}
