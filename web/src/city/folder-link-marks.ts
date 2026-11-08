import { Group, Mesh, type ShaderMaterial } from 'three'
import { deckLine } from './bridges'
import type { FolderFlow } from './folder-links'
import type { Bridge, Ferry } from './links'
import { INCOMING_LINK, OUTGOING_LINK } from './render/palette'
import { createScreenLines } from './render/screen-lines'
import type { Direction } from './selection-links'
import { boardToThree, srgb, type Vec3 } from './world/units'

// The bridges and ferry lines of a selected folder: a band along each linked bridge's deck and a
// line over each linked ferry's route, Marine where the folder imports the other side, Sun where
// the other side imports it, both side by side when it goes both ways.

const COLOURS: Record<Direction, Vec3> = {
  outgoing: srgb(OUTGOING_LINK),
  incoming: srgb(INCOMING_LINK),
}
const WHITE = srgb('#FFFFFF')

/** A band on a deck, in CSS pixels, over a white halo; side by side at this share of its width. */
const BAND_WIDTH = 3.2
const BAND_HALO = 6
const HALO_OPACITY = 0.9
const BAND_APART = 0.22
/** Above the deck's top, in u. */
const BAND_RISE = 0.05
/**
 * A ferry's line, in CSS pixels; its dash and gap painted on the sea, in u, as the ferry lines'
 * own (they keep their place when the camera moves, and fill in from afar); side by side this
 * far apart, in u.
 */
const FERRY_WIDTH = 3
const FERRY_DASH: [number, number] = [1.2, 0.9]
const FERRY_APART = 0.35
/** Just above the ferry lines (0.04 u). */
const FERRY_ALTITUDE = 0.06
/** What shows of the other ways while some stand out, and how much wider those are, in px. */
const FADED = 0.3
const FOCUS_WIDER = 1.5
/** Over the bridges and the sea, under the arcs. */
const ORDER = 6

/** The lines to draw along a selected folder's ways, in three.js coordinates. */
export interface FolderWays {
  bands: Record<Direction, Vec3[][]>
  ferries: Record<Direction, Vec3[][]>
}

/** Which ways of `island` its folder's flows run along, and where their lines go. */
export function folderWays(
  island: number,
  flows: ReadonlyMap<number, FolderFlow>,
  bridges: readonly Bridge[],
  ferries: readonly Ferry[],
): FolderWays {
  const ways: FolderWays = {
    bands: { outgoing: [], incoming: [] },
    ferries: { outgoing: [], incoming: [] },
  }
  // The directions of a pair with the selected folder's island, each with its side: −1, 0 or 1.
  const sides = (a: number, b: number): [Direction, number][] => {
    const other = a === island ? b : b === island ? a : null
    const flow = other === null ? undefined : flows.get(other)
    const directions = (['outgoing', 'incoming'] as const).filter((way) => flow?.[way])
    return directions.map((way, at) => [way, directions.length > 1 ? 2 * at - 1 : 0])
  }
  for (const bridge of bridges) {
    for (const [way, side] of sides(bridge.a, bridge.b)) {
      const line = deckLine(bridge, side * BAND_APART * bridge.width, BAND_RISE)
      ways.bands[way].push(line.map((point) => boardToThree(...point)))
    }
  }
  for (const ferry of ferries) {
    for (const [way, side] of sides(ferry.a, ferry.b)) {
      ways.ferries[way].push(aside(ferry.path, side * FERRY_APART))
    }
  }
  return ways
}

/** A route moved aside by `offset` u, to its left (board coordinates, on the sea). */
function aside(path: readonly { x: number; y: number }[], offset: number): Vec3[] {
  return path.map(({ x, y }, at) => {
    const before = path[Math.max(at - 1, 0)] ?? { x, y }
    const after = path[Math.min(at + 1, path.length - 1)] ?? { x, y }
    const dx = after.x - before.x
    const dy = after.y - before.y
    const length = Math.hypot(dx, dy) || 1
    return boardToThree(x - (dy / length) * offset, y + (dx / length) * offset, FERRY_ALTITUDE)
  })
}

/** The marks of a selected folder's bridges and ferry lines. */
export class FolderLinkMarks {
  readonly group = new Group()

  constructor(private readonly pixelRatio: number) {
    this.group.visible = false
  }

  /**
   * Draws these ways, or none. With a `focus`, those stand out, wider, and the rest fade behind
   * them.
   */
  show(ways: FolderWays | null, focus: FolderWays | null = null): void {
    this.clear()
    if (!ways) {
      return
    }
    this.draw(ways, focus ? FADED : 1, 0)
    if (focus) {
      this.draw(focus, 1, FOCUS_WIDER)
    }
    this.group.visible = this.group.children.length > 0
  }

  private draw(ways: FolderWays, opacity: number, wider: number): void {
    for (const way of ['outgoing', 'incoming'] as const) {
      const colour = COLOURS[way]
      const bands = ways.bands[way]
      if (bands.length > 0) {
        this.add(
          createScreenLines(
            bands,
            { width: BAND_HALO + wider, colour: WHITE, opacity: HALO_OPACITY * opacity },
            this.pixelRatio,
            false,
          ),
          ORDER,
        )
        this.add(
          createScreenLines(
            bands,
            { width: BAND_WIDTH + wider, colour, opacity },
            this.pixelRatio,
            false,
          ),
          ORDER + 1,
        )
      }
      const lines = ways.ferries[way]
      if (lines.length > 0) {
        this.add(
          createScreenLines(
            lines,
            { width: FERRY_WIDTH + wider, colour, sceneDash: FERRY_DASH, opacity },
            this.pixelRatio,
            false,
          ),
          ORDER + 1,
        )
      }
    }
  }

  dispose(): void {
    this.clear()
  }

  private add(mesh: Mesh, order: number): void {
    mesh.renderOrder = order
    this.group.add(mesh)
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
