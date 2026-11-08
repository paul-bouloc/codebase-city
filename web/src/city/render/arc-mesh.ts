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
import type { Vec3 } from '../world/units'
import { type ArcLabel, labelMesh } from './arc-label'
import { dotFragment, dotVertex, lineFragment, lineVertex } from './arc-shaders'
import { easeStandard } from './easing'
import { createScreenLines, lineGeometry } from './screen-lines'

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
  /** Part of an import cycle: drawn whole, without dashes. Dashed if absent. */
  solid?: boolean
  /** Just shown: it grows from its start (1) or from its end (−1). Drawn whole if absent. */
  grows?: 1 | -1
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

export interface ArcDrawing {
  lines: ArcLine[]
  dots: ArcDot[]
  /** Dashed stems from a hub down to its island, by colour. */
  stems: { colour: Vec3; polylines: Vec3[][] }[]
  labels: ArcLabel[]
}

/** The white halo past each side of a ribbon, in CSS pixels. */
const HALO = 1.5
/** What shows of an arc behind the buildings. */
const HIDDEN_OPACITY = 0.4
/** Dashes and gaps along an arc, in u: one period goes by in `DASH_TIME` seconds. */
const DASH: [number, number] = [0.6, 0.4]
const UPWARD_DASH: [number, number] = [0.55, 0.45]
/** A dash as long as its period, with no gap: a solid line. */
const SOLID: [number, number] = [1, 0]
/** Both dash periods, in u. */
export const DASH_PERIOD = 1
export const DASH_TIME = 1.2
/** Arcs opened out of a bundle grow to their file in this many ms. */
const GROW_DURATION = 300
const STEM_WIDTH = 1.5
const STEM_DASH: [number, number] = [2, 3]
/** Drawn after the city and the outlines of its marked buildings. */
const ARC_ORDER = 10

/** The arcs of the selection, redrawn whenever it changes. */
export class ArcLayer {
  readonly group = new Group()
  private readonly resolution: IUniform<Vector2> = { value: new Vector2(1, 1) }
  private readonly phase: IUniform<number> = { value: 0 }
  private readonly stillness: IUniform<number> = { value: 0 }
  private readonly growth: IUniform<number> = { value: 1 }
  private growingSince: number | null = null
  private growing = false
  private moving = false
  private labels: { material: ShaderMaterial; rimmed: boolean }[] = []

  constructor(private readonly pixelRatio: number) {
    this.group.visible = false
  }

  /** Draws these arcs, or none. */
  show(drawing: ArcDrawing | null): void {
    this.clear()
    if (!drawing || (drawing.lines.length === 0 && drawing.labels.length === 0)) {
      return
    }
    this.moving = drawing.lines.some((line) => !line.solid)
    this.growing = drawing.lines.some((line) => line.grows)
    this.growth.value = this.growing ? 0 : 1
    this.growingSince = null
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
      const mesh = labelMesh(label, this.pixelRatio, this.resolution)
      this.labels.push({ material: mesh.material as ShaderMaterial, rimmed: label.rimmed ?? false })
      this.add(mesh, ARC_ORDER + 6)
    }
    this.group.visible = true
  }

  /** Whether the arcs on show have dashes to move. */
  get moves(): boolean {
    return this.moving
  }

  /** Rims the count of the hub at this index (in the order of the drawing's labels), or none. */
  hoverLabel(index: number | null): void {
    this.labels.forEach(({ material, rimmed }, at) => {
      const uniform = material.uniforms.hovered
      if (uniform) {
        uniform.value = rimmed || at === index ? 1 : 0
      }
    })
  }

  /** Whether arcs just opened are still growing. */
  get grows(): boolean {
    return this.growing
  }

  /** Grows the arcs just opened to where they are at `now` (ms); still, at once. */
  grow(now: number, still: boolean): void {
    if (this.growingSince === null) {
      this.growingSince = now
    }
    const progress = still ? 1 : Math.min((now - this.growingSince) / GROW_DURATION, 1)
    this.growth.value = easeStandard(progress)
    if (progress >= 1) {
      this.growth.value = 1
      this.growing = false
    }
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
    this.growing = false
    this.labels = []
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
    const grows: number[] = []
    for (const arc of arcs) {
      let total = 0
      for (let i = 1; i < arc.points.length; i++) {
        const a = arc.points[i - 1] as Vec3
        const b = arc.points[i] as Vec3
        total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
      }
      const dash = arc.solid ? SOLID : arc.upward ? UPWARD_DASH : DASH
      // Four corners per segment.
      for (let corner = 0; corner < 4 * (arc.points.length - 1); corner++) {
        totals.push(total)
        widths.push(arc.width * this.pixelRatio)
        colours.push(...arc.colour)
        dashes.push(...dash)
        grows.push(arc.grows ?? 0)
      }
    }
    geometry.setAttribute('total', new Float32BufferAttribute(totals, 1))
    geometry.setAttribute('width', new Float32BufferAttribute(widths, 1))
    geometry.setAttribute('colour', new Float32BufferAttribute(colours, 3))
    geometry.setAttribute('dash', new Float32BufferAttribute(dashes, 2))
    geometry.setAttribute('grows', new Float32BufferAttribute(grows, 1))
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
        growth: this.growth,
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
