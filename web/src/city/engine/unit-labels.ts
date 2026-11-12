import { type PerspectiveCamera, Vector3 } from 'three'
import type { CityGuideUnit } from '../interaction/city-guide'
import type { CityLayout } from '../world/layout'
import type { Vec3 } from '../world/units'
import { canvasMeasure } from './area-labels'
import { type GuideLabelKind, type Measure, type PlacedLabel, pillSize } from './label-pills'
import { type LabelArea, labelAreas } from './label-placement'

// The labels of the units of packages a step of the guide shows: each pinned straight over the
// middle of its island by a leader as long as the others. They never move aside: where they
// cross, the nearer one is drawn over the farther, as the islands are.

/** A unit on this many islands or fewer gets a leader to each: past them, to its largest alone. */
const MAX_LEADERS = 4
/** A label stands this many CSS pixels over its anchor. */
export const LABEL_LIFT = 24

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

/** A label on show this frame: its box on the canvas, in CSS pixels. */
interface Shown {
  label: UnitLabel
  box: { x: number; y: number; width: number; height: number }
}

export class UnitLabels {
  private areas = new Map<string, LabelArea>()
  private labels: UnitLabel[] = []
  /** Whether the step shows units. */
  private showing = false
  /** The islands holding a unit's parcel: their own labels stay, to say where it lies. */
  private hostIslands = new Set<number>()
  /** The labels on show this frame, the farthest first. */
  private shown: Shown[] = []
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
  }

  /**
   * The labels on show this frame, each straight over its anchor, the farthest first: each is
   * drawn over those before it.
   */
  place(): PlacedLabel[] {
    this.width = this.canvas.clientWidth
    this.height = this.canvas.clientHeight
    if (this.labels.length === 0 || this.width === 0 || this.height === 0) {
      this.shown = []
      return []
    }
    const found = this.labels.flatMap((label) => {
      const anchor = this.onCanvas(label.anchor)
      if (!anchor) {
        return []
      }
      const { width, height } = pillSize(
        label.kind !== 'parcel',
        label.name,
        label.caption,
        (text, font) => this.widthOf(text, font),
        label.kind,
      )
      const box = { x: anchor.x - width / 2, y: anchor.y - LABEL_LIFT - height, width, height }
      return [{ label, anchor, box }]
    })
    found.sort((a, b) => b.anchor.depth - a.anchor.depth)
    this.shown = found
    return found.map(({ label, anchor, box }, order) => ({
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
      order,
    }))
  }

  /** The island or folder whose label is at this point of the canvas, the nearest drawn on top. */
  at(x: number, y: number): Target | null {
    for (let at = this.shown.length - 1; at >= 0; at -= 1) {
      const shown = this.shown[at]
      if (!shown) {
        continue
      }
      const { box } = shown
      if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) {
        return shown.label.target
      }
    }
    return null
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

  private widthOf(text: string, font: string): number {
    const key = `${font}\n${text}`
    let width = this.widths.get(key)
    if (width === undefined) {
      width = Math.ceil(this.measure(text, font))
      this.widths.set(key, width)
    }
    return width
  }

  /** A point on the canvas, and how deep (larger is farther); null behind the camera. */
  private onCanvas(point: Vec3): { x: number; y: number; depth: number } | null {
    const projected = this.projected.set(...point).project(this.camera)
    if (projected.z > 1) {
      return null
    }
    return {
      x: ((projected.x + 1) / 2) * this.width,
      y: ((1 - projected.y) / 2) * this.height,
      depth: projected.z,
    }
  }
}

function keyOf(target: Target): string {
  return target.kind === 'island' ? `${target.island}` : `${target.island}/${target.parcel}`
}
