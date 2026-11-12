import { DoubleSide, Group, type Mesh, type ShaderMaterial } from 'three'
import {
  disposePill,
  drawPill,
  type PillLine,
  type PillStyle,
  pillMesh,
  setPill,
} from '../render/label-pill'
import type { Vec3 } from '../world/units'

// The labels of islands and folders as the city draws them: a cream pill each, the line of
// figures over the name, faded in as they come and out as they go.

/** The width of a text in a CSS font, in CSS pixels. */
export type Measure = (text: string, font: string) => number

/** Which way a label runs from its anchor on screen: out to the sea, or around it for a folder. */
export type LabelLean = 'start' | 'end' | 'above' | 'below' | 'centre'

/** A label the city shows this frame. Pixels are CSS pixels on the canvas. */
export interface PlacedLabel {
  path: string
  island: boolean
  name: string
  caption: string | null
  selected: boolean
  lean: LabelLean
  /** Where it stands in the world, and on the canvas. */
  anchor: Vec3
  x: number
  y: number
  /** Its pill's box on the canvas. */
  box: { x: number; y: number; width: number; height: number }
}

/** A label comes and goes over this many ms. */
const FADE_MS = 150

const INK = '#23313A'
const SECONDARY = '#56656B'
const ISLAND_NAME = { font: '600 15px "Space Grotesk", system-ui, sans-serif', height: 19 }
const CAPTION = { font: '500 10px "JetBrains Mono", ui-monospace, monospace', height: 13 }
const PARCEL_NAME = { font: '400 11px "JetBrains Mono", ui-monospace, monospace', height: 14 }
const ISLAND_PADDING = { across: 8, down: 4 }
const PARCEL_PADDING = { across: 8, down: 3 }
const RIM = { colour: INK, width: 1.5 }
const ISLAND_STYLE: PillStyle = {
  fill: 'rgba(255, 250, 240, 0.93)',
  radius: 12,
  padding: ISLAND_PADDING,
  shadow: { colour: 'rgba(40, 60, 60, 0.16)', blur: 12, down: 4, margin: 16 },
}
const PARCEL_STYLE: PillStyle = {
  fill: 'rgba(255, 250, 240, 0.94)',
  radius: 12,
  padding: PARCEL_PADDING,
}

/** The lines of a label, from the top: the figures over an island's name. */
function linesOf(island: boolean, name: string, caption: string | null): PillLine[] {
  if (!island) {
    return [{ text: name, colour: INK, ...PARCEL_NAME }]
  }
  const lines: PillLine[] = []
  if (caption !== null) {
    lines.push({ text: caption, colour: SECONDARY, ...CAPTION })
  }
  lines.push({ text: name, colour: INK, ...ISLAND_NAME })
  return lines
}

/** The size of a label's pill, in CSS pixels. */
export function pillSize(
  island: boolean,
  name: string,
  caption: string | null,
  widthOf: Measure,
): { width: number; height: number } {
  const lines = linesOf(island, name, caption)
  const padding = island ? ISLAND_PADDING : PARCEL_PADDING
  const text = Math.max(...lines.map((line) => Math.ceil(widthOf(line.text, line.font))))
  return {
    width: text + 2 * padding.across,
    height: lines.reduce((sum, line) => sum + line.height, 0) + 2 * padding.down,
  }
}

interface Pill {
  mesh: Mesh
  /** What its texture shows: drawn again when that changes. */
  look: string
  opacity: number
  shown: boolean
  /** Where its quad last stood from the anchor, in device pixels. */
  offset: { x: number; y: number }
  /** The room around the pill its shadow takes, in device pixels. */
  margin: number
}

export class LabelPills {
  readonly group = new Group()
  private readonly pills = new Map<string, Pill>()
  /** Bumped when the fonts load: every pill is drawn again. */
  private generation = 0
  private lastTime: number | null = null

  constructor(private readonly ratio: () => number) {}

  /** Draws every pill again: the fonts they are written in have loaded since. */
  redraw(): void {
    this.generation += 1
  }

  /**
   * Shows these labels, `now` in ms, on whole pixels if `snap`, at once if `instant`; fades out
   * the others. True while some still fade: the city must draw again.
   */
  show(
    labels: readonly PlacedLabel[],
    now: number,
    { snap, instant }: { snap: boolean; instant: boolean },
  ): boolean {
    const elapsed = this.lastTime === null ? 0 : now - this.lastTime
    this.lastTime = now
    const step = instant ? 1 : Math.min(elapsed / FADE_MS, 1)
    const ratio = this.ratio()
    const on = new Set<string>()
    for (const label of labels) {
      on.add(label.path)
      const look = [
        this.generation,
        ratio,
        label.island,
        label.name,
        label.caption ?? '',
        label.selected,
      ].join('\u0000')
      let pill = this.pills.get(label.path)
      if (!pill || pill.look !== look) {
        const opacity = pill?.opacity ?? 0
        if (pill) {
          this.drop(label.path, pill)
        }
        pill = this.draw(label, look, ratio, opacity)
      }
      pill.shown = true
      pill.offset = {
        x: Math.round((label.box.x - label.x) * ratio) - pill.margin,
        y: Math.round((label.box.y - label.y) * ratio) - pill.margin,
      }
    }
    let fading = false
    for (const [path, pill] of this.pills) {
      if (!on.has(path)) {
        pill.shown = false
      }
      const target = pill.shown ? 1 : 0
      pill.opacity =
        target > pill.opacity ? Math.min(pill.opacity + step, 1) : Math.max(pill.opacity - step, 0)
      if (!pill.shown && pill.opacity === 0) {
        this.drop(path, pill)
        continue
      }
      fading ||= pill.opacity !== target
      setPill(pill.mesh, { ...pill.offset, snap, opacity: pill.opacity })
    }
    return fading
  }

  /** Takes every pill away at once. */
  clear(): void {
    for (const [path, pill] of this.pills) {
      this.drop(path, pill)
    }
    this.lastTime = null
  }

  dispose(): void {
    this.clear()
  }

  private draw(label: PlacedLabel, look: string, ratio: number, opacity: number): Pill {
    const texture = drawPill(
      linesOf(label.island, label.name, label.caption),
      label.box.width,
      {
        ...(label.island ? ISLAND_STYLE : PARCEL_STYLE),
        ...(label.selected ? { rim: RIM } : {}),
      },
      ratio,
    )
    const mesh = pillMesh(label.anchor, texture)
    ;(mesh.material as ShaderMaterial).side = DoubleSide
    // Islands over folders, all over the city.
    mesh.renderOrder = label.island ? 1001 : 1000
    this.group.add(mesh)
    const pill: Pill = {
      mesh,
      look,
      opacity,
      shown: true,
      offset: { x: 0, y: 0 },
      margin: texture.margin,
    }
    this.pills.set(label.path, pill)
    return pill
  }

  private drop(path: string, pill: Pill): void {
    this.group.remove(pill.mesh)
    disposePill(pill.mesh)
    this.pills.delete(path)
  }
}
