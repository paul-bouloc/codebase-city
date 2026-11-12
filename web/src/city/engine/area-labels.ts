import { type PerspectiveCamera, Vector3 } from 'three'
import type { AreaLabel, AreaLabelText, LabelLean } from '../interaction/city-items'
import type { CityTarget } from '../interaction/picking'
import type { CityLayout } from '../world/layout'
import type { Vec3 } from '../world/units'
import {
  ISLAND_LABEL_PIXELS,
  LABEL_GRACE_MS,
  LABEL_HYSTERESIS,
  LABEL_SETTLE_MS,
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

const ISLAND_NAME_FONT = '600 15px "Space Grotesk", system-ui, sans-serif'
const CAPTION_FONT = '500 10px "JetBrains Mono", ui-monospace, monospace'
const PARCEL_FONT = '400 11px "JetBrains Mono", ui-monospace, monospace'
/** Boxes, in CSS pixels: padding across and down, and the height of each line. */
const ISLAND_PADDING = { across: 8, down: 4 }
const ISLAND_NAME_LINE = 19
const CAPTION_LINE = 13
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
  /** The labels on show, by path, and whether with their line of figures. */
  private onShow = new Map<string, boolean>()
  /** The labels waiting to come, by path, and since when they have had room. */
  private waiting = new Map<string, number>()
  /** The labels on show over a label before them, by path, and since when. */
  private crowded = new Map<string, number>()
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
    this.onShow = new Map()
    this.waiting = new Map()
    this.crowded = new Map()
  }

  /** What each folder's label says, by path: a folder without one gets no label. */
  setTexts(texts: ReadonlyMap<string, AreaLabelText>): void {
    this.texts = texts
  }

  /** Measures the texts again: the fonts they are written in have loaded since. */
  remeasure(): void {
    this.widths.clear()
  }

  /** Whether labels wait to come or go: the city must draw again for them, even standing still. */
  get pending(): boolean {
    return this.waiting.size > 0 || this.crowded.size > 0
  }

  /**
   * The labels on show this frame, `now` in ms, or null when they stand where they last stood.
   * A label comes once it has had room for `LABEL_SETTLE_MS` in a row; the selected one at once.
   */
  place(selected: CityTarget | null, now: number): readonly AreaLabel[] | null {
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
      const wasShown = this.onShow.get(area.path)
      // A label on show goes only once its area is well under the threshold it passed.
      const keep = (pixels: number, kept: boolean | undefined) =>
        kept ? pixels / LABEL_HYSTERESIS : pixels
      const span = area.extent * this.pixelsPerUnit(area.centre)
      const threshold = island ? ISLAND_LABEL_PIXELS : PARCEL_LABEL_PIXELS
      if (span < keep(threshold, wasShown !== undefined) && !isSelected) {
        continue
      }
      const anchor = this.onCanvas(area.anchor)
      if (!anchor || anchor.x < 0 || anchor.x > width || anchor.y < 0 || anchor.y > height) {
        continue
      }
      const lean = island ? leanAway(anchor, this.onCanvas(area.centre)) : 'centre'
      const caption = island && span >= keep(CAPTION_PIXELS, wasShown) ? text.caption : null
      const size = this.boxSize(island, text.name, caption)
      const { x, y } = boxCorner(anchor, size, lean)
      candidates.push({
        island,
        span,
        selected: isSelected,
        shown: wasShown !== undefined || isSelected,
        x,
        y,
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
    // Labels with room to come start, or keep, waiting; labels on show that meet one before
    // them start, or keep, their grace. The others wait no more.
    const room = placeLabels(candidates)
    const waiting = new Map<string, number>()
    const crowded = new Map<string, number>()
    candidates.forEach(({ label, shown }, at) => {
      if (room[at] && !shown) {
        waiting.set(label.path, this.waiting.get(label.path) ?? now)
      } else if (!room[at] && shown) {
        crowded.set(label.path, this.crowded.get(label.path) ?? now)
      }
    })
    const pathAt = (at: number) => candidates[at]?.label.path ?? ''
    const placed = placeLabels(candidates, {
      ready: (at) => now - (waiting.get(pathAt(at)) ?? now) >= LABEL_SETTLE_MS,
      tolerated: (at) => now - (crowded.get(pathAt(at)) ?? now) < LABEL_GRACE_MS,
    })
    candidates.forEach(({ label }, at) => {
      if (placed[at]) {
        waiting.delete(label.path)
      } else {
        crowded.delete(label.path)
      }
    })
    this.waiting = waiting
    this.crowded = crowded
    const kept = candidates.filter((_, at) => placed[at])
    this.onShow = new Map(kept.map(({ label }) => [label.path, label.caption !== null]))
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

/** Which way an island's label runs: away from the island's middle, as the screen shows it. */
function leanAway(
  anchor: { x: number; y: number },
  centre: { x: number; y: number } | null,
): LabelLean {
  if (!centre) {
    return 'end'
  }
  const across = anchor.x - centre.x
  const down = anchor.y - centre.y
  if (Math.abs(across) >= Math.abs(down)) {
    return across >= 0 ? 'start' : 'end'
  }
  return down >= 0 ? 'below' : 'above'
}

/** The top left corner of a label's box, from its anchor and the way it runs. */
function boxCorner(
  anchor: { x: number; y: number },
  size: { width: number; height: number },
  lean: LabelLean,
): { x: number; y: number } {
  const x =
    lean === 'start' ? anchor.x : lean === 'end' ? anchor.x - size.width : anchor.x - size.width / 2
  const y =
    lean === 'above'
      ? anchor.y - size.height
      : lean === 'below'
        ? anchor.y
        : anchor.y - size.height / 2
  return { x, y }
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
