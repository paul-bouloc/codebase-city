import { type PerspectiveCamera, Vector3 } from 'three'
import type { AreaLabel, AreaLabelText, LabelLean } from '../interaction/city-items'
import type { CityTarget } from '../interaction/picking'
import type { CityLayout } from '../world/layout'
import type { Vec3 } from '../world/units'
import {
  ISLAND_LABEL_PIXELS,
  type LabelArea,
  type LabelCandidate,
  labelAreas,
  PARCEL_LABEL_PIXELS,
  placeLabels,
} from './label-placement'

// The labels of islands and folders: where each would stand on the page this frame, and which
// of them show. The screen writes them; their fonts and boxes here match its styles.

/** The width of a text in a CSS font, in CSS pixels. */
export type Measure = (text: string, font: string) => number

/** An island's label shows its line of figures once its plateau spans this many CSS pixels. */
export const CAPTION_PIXELS = 160

const ISLAND_NAME_FONT = '600 22px "Space Grotesk", system-ui, sans-serif'
const CAPTION_FONT = '500 11px "JetBrains Mono", ui-monospace, monospace'
const PARCEL_FONT = '400 11px "JetBrains Mono", ui-monospace, monospace'
/** Boxes, in CSS pixels: padding across and down, and the height of each line. */
const ISLAND_PADDING = { across: 12, down: 6 }
const ISLAND_NAME_LINE = 28
const CAPTION_LINE = 14
const PARCEL_PADDING = { across: 8, down: 3 }
const PARCEL_LINE = 14

interface Shown {
  target: LabelArea['target']
  x: number
  y: number
  width: number
  height: number
}

export class AreaLabels {
  private areas: LabelArea[] = []
  private texts: ReadonlyMap<string, AreaLabelText> = new Map()
  private readonly widths = new Map<string, number>()
  private shown: Shown[] = []
  private last: readonly AreaLabel[] = []
  private readonly projected = new Vector3()

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: PerspectiveCamera,
    private readonly measure: Measure = canvasMeasure(),
  ) {}

  /** The city whose islands and folders get labels; none for no city. */
  setLayout(layout: CityLayout | null): void {
    this.areas = layout ? labelAreas(layout) : []
    this.shown = []
  }

  /** What each folder's label says, by path: a folder without one gets no label. */
  setTexts(texts: ReadonlyMap<string, AreaLabelText>): void {
    this.texts = texts
  }

  /** Measures the texts again: the fonts they are written in have loaded since. */
  remeasure(): void {
    this.widths.clear()
  }

  /** The labels on show this frame, or null when they stand where they last stood. */
  place(selected: CityTarget | null): readonly AreaLabel[] | null {
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    const candidates: (LabelCandidate & { area: LabelArea; label: AreaLabel })[] = []
    for (const area of this.areas) {
      const text = this.texts.get(area.path)
      if (!text || width === 0 || height === 0) {
        continue
      }
      const island = area.target.kind === 'island'
      const isSelected = sameTarget(area.target, selected)
      const span = area.extent * this.pixelsPerUnit(area.centre)
      if (span < (island ? ISLAND_LABEL_PIXELS : PARCEL_LABEL_PIXELS) && !isSelected) {
        continue
      }
      const anchor = this.onCanvas(area.anchor)
      if (!anchor || anchor.x < 0 || anchor.x > width || anchor.y < 0 || anchor.y > height) {
        continue
      }
      const centre = this.onCanvas(area.centre)
      const lean: LabelLean = !island ? 'centre' : centre && centre.x < anchor.x ? 'start' : 'end'
      const caption = island && span >= CAPTION_PIXELS ? text.caption : null
      const size = this.boxSize(island, text.name, caption)
      const left =
        lean === 'start'
          ? anchor.x
          : lean === 'end'
            ? anchor.x - size.width
            : anchor.x - size.width / 2
      candidates.push({
        island,
        span,
        selected: isSelected,
        x: left,
        y: anchor.y - size.height / 2,
        ...size,
        area,
        label: {
          path: area.path,
          island,
          name: text.name,
          caption,
          x: Math.round(anchor.x),
          y: Math.round(anchor.y),
          lean,
        },
      })
    }
    const placed = placeLabels(candidates)
    const kept = candidates.filter((_, at) => placed[at])
    this.shown = kept.map(({ area, x, y, width, height }) => ({
      target: area.target,
      x,
      y,
      width,
      height,
    }))
    const box = kept.length > 0 ? this.canvas.getBoundingClientRect() : { left: 0, top: 0 }
    const labels = kept.map(({ label }) => ({
      ...label,
      x: label.x + Math.round(box.left),
      y: label.y + Math.round(box.top),
    }))
    if (sameLabels(labels, this.last)) {
      return null
    }
    this.last = labels
    return labels
  }

  /** The island or folder whose label is at this point of the canvas, in CSS pixels. */
  at(x: number, y: number): LabelArea['target'] | null {
    const found = this.shown.find(
      (label) =>
        x >= label.x && x <= label.x + label.width && y >= label.y && y <= label.y + label.height,
    )
    return found?.target ?? null
  }

  private boxSize(
    island: boolean,
    name: string,
    caption: string | null,
  ): { width: number; height: number } {
    if (!island) {
      return {
        width: this.widthOf(name, PARCEL_FONT) + 2 * PARCEL_PADDING.across,
        height: PARCEL_LINE + 2 * PARCEL_PADDING.down,
      }
    }
    const text = Math.max(
      this.widthOf(name, ISLAND_NAME_FONT),
      caption === null ? 0 : this.widthOf(caption, CAPTION_FONT),
    )
    return {
      width: text + 2 * ISLAND_PADDING.across,
      height: ISLAND_NAME_LINE + (caption === null ? 0 : CAPTION_LINE) + 2 * ISLAND_PADDING.down,
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

  /** A unit's span on screen at this point, in CSS pixels; 0 behind the camera. */
  private pixelsPerUnit(point: Vec3): number {
    const { camera } = this
    const depth = -this.projected.set(...point).applyMatrix4(camera.matrixWorldInverse).z
    if (depth <= 0) {
      return 0
    }
    return (this.canvas.clientHeight * camera.projectionMatrix.elements[5]) / 2 / depth
  }

  private onCanvas(point: Vec3): { x: number; y: number } | null {
    const projected = this.projected.set(...point).project(this.camera)
    if (projected.z > 1) {
      return null
    }
    return {
      x: ((projected.x + 1) / 2) * this.canvas.clientWidth,
      y: ((1 - projected.y) / 2) * this.canvas.clientHeight,
    }
  }
}

function sameTarget(area: LabelArea['target'], selected: CityTarget | null): boolean {
  if (!selected || selected.kind !== area.kind || selected.island !== area.island) {
    return false
  }
  return area.kind === 'island' || (selected.kind === 'parcel' && selected.parcel === area.parcel)
}

function sameLabels(a: readonly AreaLabel[], b: readonly AreaLabel[]): boolean {
  return (
    a.length === b.length &&
    a.every((label, at) => {
      const other = b[at]
      return (
        other !== undefined &&
        label.path === other.path &&
        label.x === other.x &&
        label.y === other.y &&
        label.caption === other.caption &&
        label.lean === other.lean &&
        label.name === other.name
      )
    })
  )
}

/**
 * Measures on a canvas of its own, in the fonts the page loaded; without a page (tests), as if
 * each character were 0.6 of the font's size.
 */
function canvasMeasure(): Measure {
  const context =
    typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  return (text, font) => {
    if (!context) {
      const size = Number(/(\d+)px/.exec(font)?.[1] ?? 12)
      return text.length * size * 0.6
    }
    context.font = font
    return context.measureText(text).width
  }
}
