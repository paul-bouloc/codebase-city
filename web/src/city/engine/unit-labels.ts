import { type PerspectiveCamera, Vector3 } from 'three'
import type { CityGuideUnit } from '../interaction/city-guide'
import type { CityLayout } from '../world/layout'
import type { Vec3 } from '../world/units'
import { canvasMeasure } from './area-labels'
import { type GuideLabelKind, type Measure, type PlacedLabel, pillSize } from './label-pills'
import { type LabelArea, labelAreas } from './label-placement'
import { placeUnitLabels } from './unit-label-placement'

// The labels of the units of packages a step of the guide shows: each pinned over the middle of
// its island, and the leader lines that tie it there. They are placed again each time the camera
// comes to rest; while it moves, each keeps its place over its anchor.

/** A unit on this many islands or fewer gets a leader to each: past them, to its largest alone. */
const MAX_LEADERS = 4

type Target = LabelArea['target']

interface UnitLabel {
  key: string
  target: Target
  name: string
  caption: string | null
  kind: GuideLabelKind
  /** Where it stands from, in three.js coordinates: the first of its leads. */
  anchor: Vec3
  leads: Vec3[]
}

interface Shown {
  label: UnitLabel
  /** Its box's top left corner from its anchor on screen. */
  offset: { x: number; y: number }
  width: number
  height: number
}

export class UnitLabels {
  private areas = new Map<string, LabelArea>()
  private labels: UnitLabel[] = []
  /** Whether the step shows units. */
  private showing = false
  /** The islands holding a unit's parcel: their own labels stay, to say where it lies. */
  private hostIslands = new Set<number>()
  private shown: Shown[] = []
  /**
   * The view the labels were placed for, the canvas's size then the camera's matrix: placed
   * again once it changes and comes to rest. NaN for none.
   */
  private readonly placedFor = new Float64Array(18).fill(Number.NaN)
  private readonly widths = new Map<string, number>()
  private readonly projected = new Vector3()
  private width = 0
  private height = 0

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: PerspectiveCamera,
    private readonly measure: Measure = canvasMeasure(),
  ) {}

  /** The city whose units get labels; none for no city. */
  setLayout(layout: CityLayout | null): void {
    this.areas = new Map(layout ? labelAreas(layout).map((area) => [keyOf(area.target), area]) : [])
    this.setUnits([])
  }

  /** The units a step shows, the largest first; their labels come at the next frame. */
  setUnits(units: readonly CityGuideUnit[]): void {
    this.showing = units.length > 0
    this.hostIslands = new Set(units.flatMap((unit) => (unit.parcel ? [unit.parcel.island] : [])))
    this.labels = units.flatMap((unit) => this.labelOf(unit) ?? [])
    this.shown = []
    this.placedFor.fill(Number.NaN)
  }

  /** Whether the step labels units: the labels of islands at rest then keep quiet. */
  get active(): boolean {
    return this.showing
  }

  /** Whether an island's own label stays while the step labels units: it holds one's parcel. */
  hosts(island: number): boolean {
    return this.hostIslands.has(island)
  }

  /** Measures the texts again: the fonts they are written in have loaded since. */
  remeasure(): void {
    this.widths.clear()
    this.placedFor.fill(Number.NaN)
  }

  /**
   * The labels on show this frame: placed again when the camera has come to rest somewhere
   * new, kept beside their anchors while it moves.
   */
  place(moving: boolean): PlacedLabel[] {
    this.width = this.canvas.clientWidth
    this.height = this.canvas.clientHeight
    if (this.labels.length === 0 || this.width === 0 || this.height === 0) {
      this.shown = []
      return []
    }
    if (!moving && this.viewChanged()) {
      this.arrange()
    }
    return this.shown.flatMap((shown) => {
      const { label } = shown
      const anchor = this.onCanvas(label.anchor)
      if (!anchor) {
        return []
      }
      const box = {
        x: anchor.x + shown.offset.x,
        y: anchor.y + shown.offset.y,
        width: shown.width,
        height: shown.height,
      }
      return [
        {
          path: label.key,
          island: label.kind !== 'parcel',
          name: label.name,
          caption: label.caption,
          selected: false,
          lean: 'above' as const,
          anchor: label.anchor,
          x: anchor.x,
          y: anchor.y,
          box,
          guide: label.kind,
          leads: label.leads,
        },
      ]
    })
  }

  /** The island or folder whose label is at this point of the canvas, in CSS pixels. */
  at(x: number, y: number): Target | null {
    for (let at = this.shown.length - 1; at >= 0; at -= 1) {
      const shown = this.shown[at]
      const anchor = shown && this.onCanvas(shown.label.anchor)
      if (!shown || !anchor) {
        continue
      }
      const left = anchor.x + shown.offset.x
      const top = anchor.y + shown.offset.y
      if (x >= left && x <= left + shown.width && y >= top && y <= top + shown.height) {
        return shown.label.target
      }
    }
    return null
  }

  /** Whether the canvas or the camera changed since the labels were placed; notes the new view. */
  private viewChanged(): boolean {
    const view = this.placedFor
    const { elements } = this.camera.matrixWorld
    let changed = view[0] !== this.width || view[1] !== this.height
    view[0] = this.width
    view[1] = this.height
    for (let at = 0; at < elements.length; at += 1) {
      changed ||= view[at + 2] !== elements[at]
      view[at + 2] = elements[at] ?? Number.NaN
    }
    return changed
  }

  /** Places every label whose anchor is on the canvas, the largest unit first. */
  private arrange(): void {
    const candidates = this.labels.flatMap((label) => {
      const anchor = this.onCanvas(label.anchor)
      if (!anchor || !this.inside(anchor)) {
        return []
      }
      const size = pillSize(
        label.kind !== 'parcel',
        label.name,
        label.caption,
        (text, font) => this.widthOf(text, font),
        label.kind,
      )
      return [{ label, ...anchor, ...size }]
    })
    const boxes = placeUnitLabels(candidates, { width: this.width, height: this.height })
    this.shown = candidates.map(({ label, x, y, width, height }, at) => {
      const box = boxes[at] ?? { x, y }
      return {
        label,
        offset: { x: box.x - x, y: box.y - y },
        width,
        height,
      }
    })
  }

  /**
   * A unit's label: over the middle of its parcel or of its largest island, tied to the middle of
   * each of its other islands while it has few; none for a unit past the labels the step has
   * room for.
   */
  private labelOf(unit: CityGuideUnit): UnitLabel | null {
    const { label } = unit
    if (!label) {
      return null
    }
    const [largest] = unit.islands
    const target: Target | null =
      largest !== undefined
        ? { kind: 'island', island: largest }
        : unit.parcel && { kind: 'parcel', ...unit.parcel }
    const area = target && this.areas.get(keyOf(target))
    if (!target || !area) {
      return null
    }
    const kind: GuideLabelKind =
      target.kind === 'parcel' ? 'parcel' : label.caption === null ? 'short' : 'full'
    const anchor = area.centre
    const others = unit.islands.length <= MAX_LEADERS ? unit.islands.slice(1) : []
    const leads = [
      anchor,
      ...others.flatMap((island) => {
        const centre = this.areas.get(keyOf({ kind: 'island', island }))?.centre
        return centre ? [centre] : []
      }),
    ]
    return {
      key: `guide\n${unit.islands.join(',')}\n${unit.parcel ? keyOf(target) : ''}`,
      target,
      name: label.name,
      caption: label.caption,
      kind,
      anchor,
      leads,
    }
  }

  private inside(point: { x: number; y: number }): boolean {
    return point.x >= 0 && point.x <= this.width && point.y >= 0 && point.y <= this.height
  }

  private widthOf(text: string, font: string): number {
    const key = `${font}\n${text}`
    let width = this.widths.get(key)
    if (width === undefined) {
      width = Math.ceil(this.measure(text, font))
      this.widths.set(key, width)
    }
    return width
  }

  private onCanvas(point: Vec3): { x: number; y: number } | null {
    const projected = this.projected.set(...point).project(this.camera)
    if (projected.z > 1) {
      return null
    }
    return {
      x: ((projected.x + 1) / 2) * this.width,
      y: ((1 - projected.y) / 2) * this.height,
    }
  }
}

function keyOf(target: Target): string {
  return target.kind === 'island' ? `${target.island}` : `${target.island}/${target.parcel}`
}
