import {
  BufferGeometry,
  CanvasTexture,
  type DepthModes,
  Float32BufferAttribute,
  GreaterDepth,
  Group,
  type IUniform,
  LessEqualDepth,
  Mesh,
  type Object3D,
  Points,
  ShaderMaterial,
  Vector2,
} from 'three'
import { createScreenLines, lineGeometry } from './screen-lines'
import type { Vec3 } from './units'

// The arcs around a selected file, drawn over the city: ribbons a fixed width on screen over a
// white halo, dashes that move from source to target, dots at their ends, and for the bundles a
// hub with its count. Each is drawn twice: in full where nothing stands in front, at 40 % behind
// the buildings, so that an arc never vanishes.

/** One arc, from its source to its target. */
export interface ArcLine {
  points: readonly Vec3[]
  /** sRGB, as the city's shaders work. */
  colour: Vec3
  /** In CSS pixels. */
  width: number
  /** Goes up the layers: dashed apart, with white dots along it. */
  upward: boolean
}

/** A round dot, a fixed size on screen, in CSS pixels. */
export interface ArcDot {
  position: Vec3
  colour: Vec3
  size: number
  /** A ring around it, this wide; none if 0. */
  rim: number
  rimColour: Vec3
}

/** A count over a bundle's hub. */
export interface ArcLabel {
  position: Vec3
  text: string
}

export interface ArcDrawing {
  lines: ArcLine[]
  dots: ArcDot[]
  /** Dashed stems from a hub down to its island, by colour. */
  stems: { colour: Vec3; polylines: Vec3[][] }[]
  labels: ArcLabel[]
}

/** The white halo past each side of a ribbon, in CSS pixels, and how opaque it is. */
const HALO = 1.5
const HALO_OPACITY = 0.9
/** What shows of an arc behind the buildings. */
const HIDDEN_OPACITY = 0.4
/** Dashes and gaps along an arc, in u: one period goes by in `DASH_TIME` seconds. */
const DASH: [number, number] = [0.6, 0.4]
const UPWARD_DASH: [number, number] = [0.55, 0.45]
/** Both dash periods, in u. */
export const DASH_PERIOD = 1
export const DASH_TIME = 1.2
/** A dash period shorter than this many device pixels fills in, from the first to the second. */
const SOLID_BELOW = [6, 12] as const
/** Still, the arc shows its way by two light spots this far before its target, in u. */
const STILL_SPOTS = [1, 2] as const
const STEM_WIDTH = 1.5
const STEM_DASH: [number, number] = [2, 3]
/** The count sits this many CSS pixels above its hub. */
const LABEL_LIFT = 10
const LABEL_FONT = '600 12px "Space Grotesk", system-ui, sans-serif'
const LABEL_HEIGHT = 20
const LABEL_PADDING = 7
const LABEL_TEXT = '#23313A'
/** Drawn after the city and the outlines of its marked buildings. */
const ARC_ORDER = 10

const lineVertex = /* glsl */ `
uniform vec2 resolution;
uniform float halo;
attribute vec3 start;
attribute vec3 end;
attribute vec2 corner;
attribute float distance;
attribute float total;
attribute float width;
attribute vec3 colour;
attribute vec2 dash;
varying float vDistance;
varying float vTotal;
varying float vAcross;
varying float vWidth;
varying vec3 vColour;
varying vec2 vDash;
void main() {
  vec4 a = projectionMatrix * modelViewMatrix * vec4(start, 1.0);
  vec4 b = projectionMatrix * modelViewMatrix * vec4(end, 1.0);
  // An arc rises high: close up, a segment may pass behind the camera, where w turns negative
  // and its quad flips across the screen. It is cut at the near plane, or dropped if all behind.
  float nearA = a.z + a.w;
  float nearB = b.z + b.w;
  if (nearA < 0.0 && nearB < 0.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  if (nearA < 0.0) {
    a = mix(a, b, nearA / (nearA - nearB) + 1e-4);
  } else if (nearB < 0.0) {
    b = mix(b, a, nearB / (nearB - nearA) + 1e-4);
  }
  vec4 here = corner.x < 0.5 ? a : b;
  vec2 along = normalize((b.xy / b.w - a.xy / a.w) * resolution + 1e-6);
  vec2 normal = vec2(-along.y, along.x);
  float reach = (width + 2.0 * halo) * 0.5 + 0.5;
  vec2 offset = (normal * corner.y * reach + along * (corner.x * 2.0 - 1.0) * reach) / resolution;
  gl_Position = here + vec4(offset * 2.0 * here.w, 0.0, 0.0);
  vDistance = distance;
  vTotal = total;
  vAcross = corner.y * reach;
  vWidth = width;
  vColour = colour;
  vDash = dash;
}
`

const lineFragment = /* glsl */ `
uniform float halo;
uniform float opacity;
uniform float phase;
uniform float still;
varying float vDistance;
varying float vTotal;
varying float vAcross;
varying float vWidth;
varying vec3 vColour;
varying vec2 vDash;
float spot(float at, float back) {
  return 1.0 - smoothstep(0.15, 0.25, abs(back - at));
}
void main() {
  float cover = clamp((vWidth + 2.0 * halo) * 0.5 - abs(vAcross) + 0.5, 0.0, 1.0);
  if (cover <= 0.0) {
    discard;
  }
  if (halo > 0.0) {
    gl_FragColor = vec4(1.0, 1.0, 1.0, ${HALO_OPACITY.toFixed(2)} * opacity * cover);
    return;
  }
  float period = vDash.x + vDash.y;
  // From afar, once a dash and its gap span too few pixels to read, the gaps fill in.
  float pixels = period / max(fwidth(vDistance), 1e-6);
  float solid = 1.0 - smoothstep(${SOLID_BELOW[0].toFixed(1)}, ${SOLID_BELOW[1].toFixed(1)}, pixels);
  // The dashes move toward the target.
  float on = step(mod(vDistance - phase * period, period), vDash.x);
  vec3 colour = vColour;
  if (still > 0.5) {
    float back = vTotal - vDistance;
    float spots = max(spot(${STILL_SPOTS[0].toFixed(1)}, back), spot(${STILL_SPOTS[1].toFixed(1)}, back));
    colour = mix(colour, vec3(1.0), 0.7 * spots);
    on = max(on, spots);
  }
  cover *= max(on, solid);
  if (cover <= 0.0) {
    discard;
  }
  gl_FragColor = vec4(colour, opacity * cover);
}
`

const dotVertex = /* glsl */ `
attribute float size;
attribute float rim;
attribute vec3 colour;
attribute vec3 rimColour;
varying float vSize;
varying float vRim;
varying vec3 vColour;
varying vec3 vRimColour;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size + 2.0 * rim + 2.0;
  vSize = size;
  vRim = rim;
  vColour = colour;
  vRimColour = rimColour;
}
`

const dotFragment = /* glsl */ `
uniform float opacity;
varying float vSize;
varying float vRim;
varying vec3 vColour;
varying vec3 vRimColour;
void main() {
  float d = length(gl_PointCoord - 0.5) * (vSize + 2.0 * vRim + 2.0);
  float outer = clamp(vSize * 0.5 + vRim - d + 0.5, 0.0, 1.0);
  if (outer <= 0.0) {
    discard;
  }
  float inner = clamp(vSize * 0.5 - d + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(mix(vRimColour, vColour, inner), opacity * outer);
}
`

const labelVertex = /* glsl */ `
uniform vec2 resolution;
uniform vec2 size;
uniform float lift;
attribute vec2 corner;
varying vec2 vUv;
void main() {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec2 offset = vec2((corner.x - 0.5) * size.x, corner.y * size.y + lift);
  clip.xy += offset * 2.0 / resolution * clip.w;
  gl_Position = clip;
  vUv = corner;
}
`

const labelFragment = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
void main() {
  vec4 texel = texture2D(map, vUv);
  if (texel.a <= 0.0) {
    discard;
  }
  gl_FragColor = texel;
}
`

/** The arcs of the selection, redrawn whenever it changes. */
export class ArcLayer {
  readonly group = new Group()
  private readonly resolution: IUniform<Vector2> = { value: new Vector2(1, 1) }
  private readonly phase: IUniform<number> = { value: 0 }
  private readonly stillness: IUniform<number> = { value: 0 }
  private moving = false

  constructor(private readonly pixelRatio: number) {
    this.group.visible = false
  }

  /** Draws these arcs, or none. */
  show(drawing: ArcDrawing | null): void {
    this.clear()
    if (!drawing || (drawing.lines.length === 0 && drawing.labels.length === 0)) {
      return
    }
    this.moving = drawing.lines.length > 0
    if (drawing.lines.length > 0) {
      const lines = this.lines(drawing.lines)
      for (const [pass, depth, opacity] of [
        [0, GreaterDepth, HIDDEN_OPACITY],
        [3, LessEqualDepth, 1],
      ] as const) {
        this.add(new Mesh(lines, this.lineMaterial(depth, opacity, HALO)), ARC_ORDER + pass)
        this.add(new Mesh(lines, this.lineMaterial(depth, opacity, 0)), ARC_ORDER + pass + 1)
      }
    }
    if (drawing.dots.length > 0) {
      const dots = this.dots(drawing.dots)
      this.add(new Points(dots, this.dotMaterial(GreaterDepth, HIDDEN_OPACITY)), ARC_ORDER + 2)
      this.add(new Points(dots, this.dotMaterial(LessEqualDepth, 1)), ARC_ORDER + 5)
    }
    for (const { colour, polylines } of drawing.stems) {
      const stem = createScreenLines(
        polylines,
        { width: STEM_WIDTH, colour, dash: STEM_DASH },
        this.pixelRatio,
        false,
      )
      this.add(stem, ARC_ORDER + 3, true)
    }
    for (const label of drawing.labels) {
      this.add(this.label(label), ARC_ORDER + 6)
    }
    this.group.visible = true
  }

  /** Whether the arcs on show have dashes to move. */
  get moves(): boolean {
    return this.moving
  }

  /** Whether the dashes stand still. */
  get still(): boolean {
    return this.stillness.value === 1
  }

  /** Moves the dashes to where they are after this many seconds; still, they stay put. */
  update(seconds: number, still: boolean): void {
    this.stillness.value = still ? 1 : 0
    this.phase.value = still ? 0 : (seconds % DASH_TIME) / DASH_TIME
  }

  dispose(): void {
    this.clear()
  }

  /** `own`: the object keeps the buffer size it measures against itself (a screen line). */
  private add(object: Mesh | Points, order: number, own = false): void {
    object.renderOrder = order
    object.frustumCulled = false
    if (!own) {
      object.onBeforeRender = (renderer) => {
        renderer.getDrawingBufferSize(this.resolution.value)
      }
    }
    this.group.add(object)
  }

  private clear(): void {
    const geometries = new Set<BufferGeometry>()
    for (const child of [...this.group.children]) {
      this.group.remove(child)
      disposeDrawn(child, geometries)
    }
    for (const geometry of geometries) {
      geometry.dispose()
    }
    this.group.visible = false
    this.moving = false
  }

  private lines(arcs: readonly ArcLine[]): BufferGeometry {
    const geometry = lineGeometry(
      arcs.map((arc) => arc.points),
      false,
    )
    const totals: number[] = []
    const widths: number[] = []
    const colours: number[] = []
    const dashes: number[] = []
    for (const arc of arcs) {
      let total = 0
      for (let i = 1; i < arc.points.length; i++) {
        const a = arc.points[i - 1] as Vec3
        const b = arc.points[i] as Vec3
        total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
      }
      const dash = arc.upward ? UPWARD_DASH : DASH
      // Four corners per segment.
      for (let corner = 0; corner < 4 * (arc.points.length - 1); corner++) {
        totals.push(total)
        widths.push(arc.width * this.pixelRatio)
        colours.push(...arc.colour)
        dashes.push(...dash)
      }
    }
    geometry.setAttribute('total', new Float32BufferAttribute(totals, 1))
    geometry.setAttribute('width', new Float32BufferAttribute(widths, 1))
    geometry.setAttribute('colour', new Float32BufferAttribute(colours, 3))
    geometry.setAttribute('dash', new Float32BufferAttribute(dashes, 2))
    return geometry
  }

  private lineMaterial(depthFunc: DepthModes, opacity: number, halo: number): ShaderMaterial {
    return new ShaderMaterial({
      uniforms: {
        resolution: this.resolution,
        halo: { value: halo * this.pixelRatio },
        opacity: { value: opacity },
        phase: this.phase,
        still: this.stillness,
      },
      vertexShader: lineVertex,
      fragmentShader: lineFragment,
      transparent: true,
      depthWrite: false,
      depthFunc,
    })
  }

  private dots(dots: readonly ArcDot[]): BufferGeometry {
    const geometry = new BufferGeometry()
    const ratio = this.pixelRatio
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute(
        dots.flatMap((dot) => dot.position),
        3,
      ),
    )
    geometry.setAttribute(
      'size',
      new Float32BufferAttribute(
        dots.map((dot) => dot.size * ratio),
        1,
      ),
    )
    geometry.setAttribute(
      'rim',
      new Float32BufferAttribute(
        dots.map((dot) => dot.rim * ratio),
        1,
      ),
    )
    geometry.setAttribute(
      'colour',
      new Float32BufferAttribute(
        dots.flatMap((dot) => dot.colour),
        3,
      ),
    )
    geometry.setAttribute(
      'rimColour',
      new Float32BufferAttribute(
        dots.flatMap((dot) => dot.rimColour),
        3,
      ),
    )
    return geometry
  }

  private dotMaterial(depthFunc: DepthModes, opacity: number): ShaderMaterial {
    return new ShaderMaterial({
      uniforms: { opacity: { value: opacity } },
      vertexShader: dotVertex,
      fragmentShader: dotFragment,
      transparent: true,
      depthWrite: false,
      depthFunc,
    })
  }

  /** A pill with the count, drawn on a canvas, a fixed size on screen above its hub. */
  private label({ position, text }: ArcLabel): Mesh {
    const ratio = this.pixelRatio
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    let width = LABEL_HEIGHT
    if (context) {
      context.font = LABEL_FONT
      width = Math.ceil(context.measureText(text).width) + 2 * LABEL_PADDING
    }
    canvas.width = Math.ceil(width * ratio)
    canvas.height = Math.ceil(LABEL_HEIGHT * ratio)
    if (context) {
      context.scale(ratio, ratio)
      context.fillStyle = 'rgba(255, 255, 255, 0.92)'
      context.beginPath()
      context.roundRect(0.5, 0.5, width - 1, LABEL_HEIGHT - 1, LABEL_HEIGHT / 2)
      context.fill()
      context.font = LABEL_FONT
      context.fillStyle = LABEL_TEXT
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(text, width / 2, LABEL_HEIGHT / 2 + 0.5)
    }
    const texture = new CanvasTexture(canvas)
    const geometry = new BufferGeometry()
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute([...position, ...position, ...position, ...position], 3),
    )
    geometry.setAttribute('corner', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2))
    geometry.setIndex([0, 1, 2, 2, 1, 3])
    return new Mesh(
      geometry,
      new ShaderMaterial({
        uniforms: {
          resolution: this.resolution,
          size: { value: new Vector2(canvas.width, canvas.height) },
          lift: { value: LABEL_LIFT * ratio },
          map: { value: texture },
        },
        vertexShader: labelVertex,
        fragmentShader: labelFragment,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    )
  }
}

/** Lets go of what one drawn object holds; geometries shared by several passes go once, after. */
function disposeDrawn(object: Object3D, geometries: Set<BufferGeometry>): void {
  if (!(object instanceof Mesh || object instanceof Points)) {
    return
  }
  geometries.add(object.geometry)
  const material = object.material as ShaderMaterial
  const map = material.uniforms.map?.value
  if (map instanceof CanvasTexture) {
    map.dispose()
  }
  material.dispose()
}
