import { Group, type Mesh } from 'three'
import { disposeLeader, type LeaderStyle, leaderMesh, setLeader } from '../render/label-leader'
import {
  disposePill,
  drawPill,
  type PillLine,
  type PillStyle,
  pillMesh,
  setPill,
} from '../render/label-pill'
import { GUIDE } from '../render/palette'
import { srgb, type Vec3 } from '../world/units'

// The labels of islands and folders as the city draws them: a cream pill each, the line of
// figures over the name, faded in as they come and out as they go. A label of the guide's tour is
// rimmed in Jade, and leader lines tie it to what it names.

/** The width of a text in a CSS font, in CSS pixels. */
export type Measure = (text: string, font: string) => number

/** Which way a label runs from its anchor on screen: out to the sea, or around it for a folder. */
export type LabelLean = 'start' | 'end' | 'above' | 'below' | 'centre'

/** A label of the guide's tour: figures over the name, the name alone, or a folder's. */
export type GuideLabelKind = 'full' | 'short' | 'parcel'

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
  /** For a label of the guide's tour, its kind; none for an island's or a folder's at rest. */
  guide?: GuideLabelKind
  /** Points of the world its leader lines start from, to its pill: the same for a same path. */
  leads?: readonly Vec3[]
  /** Among the guide's labels, drawn over those of a lower order, its leaders too. */
  order?: number
}

/** A label comes and goes over this many ms. */
const FADE_MS = 150
/**
 * A frame counts this many ms at most towards a fade: the first frame after the city stood
 * still for a while would otherwise end every fade at once.
 */
const MAX_FRAME_MS = 50

const INK = '#23313A'
const SECONDARY = '#56656B'
const ISLAND_NAME = { font: '600 15px "Space Grotesk", system-ui, sans-serif', height: 19 }
const CAPTION = { font: '500 10px "JetBrains Mono", ui-monospace, monospace', height: 13 }
const PARCEL_NAME = { font: '400 11px "JetBrains Mono", ui-monospace, monospace', height: 14 }
const GUIDE_TEXT = '#167A5C'
const GUIDE_SHORT_NAME = { font: '600 13px "Space Grotesk", system-ui, sans-serif', height: 17 }
/**
 * The fonts labels are written in. The page loads a font only once something uses it: these
 * are asked for, so that labels are not measured and drawn in a fallback for good.
 */
export const LABEL_FONTS = [ISLAND_NAME.font, CAPTION.font, PARCEL_NAME.font, GUIDE_SHORT_NAME.font]
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
const GUIDE_FILL = 'rgba(255, 250, 240, 0.96)'
const GUIDE_STYLES: Record<GuideLabelKind, PillStyle> = {
  full: {
    fill: GUIDE_FILL,
    radius: 12,
    padding: { across: 10, down: 5 },
    rim: { colour: GUIDE, width: 2 },
    shadow: { colour: 'rgba(20, 70, 55, 0.2)', blur: 16, down: 6, margin: 20 },
  },
  short: {
    fill: GUIDE_FILL,
    radius: 9,
    padding: { across: 8, down: 3 },
    rim: { colour: GUIDE, width: 1.5 },
    shadow: { colour: 'rgba(20, 70, 55, 0.16)', blur: 10, down: 4, margin: 14 },
  },
  parcel: {
    fill: GUIDE_FILL,
    radius: 10,
    padding: { across: 9, down: 4 },
    rim: { colour: GUIDE, width: 1.5 },
    shadow: { colour: 'rgba(20, 70, 55, 0.16)', blur: 10, down: 4, margin: 14 },
  },
}
const LEADER: LeaderStyle = {
  colour: srgb(GUIDE),
  width: 1.8,
  halo: { width: 4, opacity: 0.85 },
  dot: { radius: 5, rim: 1.5 },
}
/**
 * Folders under islands, all over the city; the guide's labels over them, each with its leaders
 * just under it, in their own order.
 */
const ORDER = { parcel: 1000, island: 1001, guide: 1002 }

/** The lines of a label, from the top: the figures over an island's name. */
function linesOf(
  island: boolean,
  name: string,
  caption: string | null,
  guide?: GuideLabelKind,
): PillLine[] {
  if (guide) {
    const lines: PillLine[] = []
    if (caption !== null) {
      lines.push({ text: caption, colour: GUIDE_TEXT, ...CAPTION })
    }
    const font = guide === 'full' ? ISLAND_NAME : GUIDE_SHORT_NAME
    lines.push({ text: name, colour: GUIDE_TEXT, ...font })
    return lines
  }
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
  guide?: GuideLabelKind,
): { width: number; height: number } {
  const lines = linesOf(island, name, caption, guide)
  const padding = guide ? GUIDE_STYLES[guide].padding : island ? ISLAND_PADDING : PARCEL_PADDING
  const text = Math.max(...lines.map((line) => Math.ceil(widthOf(line.text, line.font))))
  return {
    width: text + 2 * padding.across,
    height: lines.reduce((sum, line) => sum + line.height, 0) + 2 * padding.down,
  }
}

/** An opacity a step closer to its target, and no further. */
export function fadeToward(opacity: number, target: number, step: number): number {
  return target > opacity ? Math.min(opacity + step, target) : Math.max(opacity - step, target)
}

interface Pill {
  mesh: Mesh
  /** What its texture shows: drawn again when that changes. */
  look: string
  opacity: number
  shown: boolean
  /** Where its quad last stood from the anchor, in device pixels. */
  offset: { x: number; y: number }
  /** Where its leaders end, at the middle of its bottom, from the anchor in device pixels. */
  foot: { x: number; y: number }
  /** The room around the pill its shadow takes, in device pixels. */
  margin: number
  /** Its leader lines. */
  leads: Mesh[]
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
    const elapsed = this.lastTime === null ? 0 : Math.min(now - this.lastTime, MAX_FRAME_MS)
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
        label.guide ?? '',
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
      if (label.guide) {
        const under = ORDER.guide + 2 * (label.order ?? 0)
        pill.mesh.renderOrder = under + 1
        for (const lead of pill.leads) {
          lead.renderOrder = under
        }
      }
      pill.foot = {
        x: Math.round((label.box.x + label.box.width / 2 - label.x) * ratio),
        y: Math.round((label.box.y + label.box.height - label.y) * ratio),
      }
    }
    let fading = false
    for (const [path, pill] of this.pills) {
      if (!on.has(path)) {
        pill.shown = false
      }
      const target = pill.shown ? 1 : 0
      pill.opacity = fadeToward(pill.opacity, target, step)
      if (!pill.shown && pill.opacity === 0) {
        this.drop(path, pill)
        continue
      }
      fading ||= pill.opacity !== target
      setPill(pill.mesh, { ...pill.offset, snap, opacity: pill.opacity })
      for (const lead of pill.leads) {
        setLeader(lead, { ...pill.foot, opacity: pill.opacity })
      }
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
    const style = label.guide
      ? GUIDE_STYLES[label.guide]
      : {
          ...(label.island ? ISLAND_STYLE : PARCEL_STYLE),
          ...(label.selected ? { rim: RIM } : {}),
        }
    const texture = drawPill(
      linesOf(label.island, label.name, label.caption, label.guide),
      label.box.width,
      style,
      ratio,
    )
    const mesh = pillMesh(label.anchor, texture)
    mesh.renderOrder = label.island ? ORDER.island : ORDER.parcel
    this.group.add(mesh)
    const leads = (label.leads ?? []).map((from) => {
      const lead = leaderMesh(from, label.anchor, LEADER, ratio)
      this.group.add(lead)
      return lead
    })
    const pill: Pill = {
      mesh,
      look,
      opacity,
      shown: true,
      offset: { x: 0, y: 0 },
      foot: { x: 0, y: 0 },
      margin: texture.margin,
      leads,
    }
    this.pills.set(label.path, pill)
    return pill
  }

  private drop(path: string, pill: Pill): void {
    this.group.remove(pill.mesh, ...pill.leads)
    disposePill(pill.mesh)
    for (const lead of pill.leads) {
      disposeLeader(lead)
    }
    this.pills.delete(path)
  }
}
