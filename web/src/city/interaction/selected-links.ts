import type { Group } from 'three'
import type { CityBuildings } from '../buildings/buildings'
import { type CycleOnShow, type Hub, selectionArcs } from '../flows/selection-arcs'
import {
  type Direction,
  type ImportIndex,
  type LinkEnd,
  type Linked,
  linkedBuildings,
  markedBuildings,
  OPENED_ARCS,
  openBundle,
  type SelectionLinks,
  selectionLinks,
} from '../flows/selection-links'
import type { ArcLayer } from '../render/arc-mesh'
import type { CityLayout } from '../world/layout'
import { boardToThree, layerAltitude, type Vec3 } from '../world/units'
import { BuildingMark, INCOMING_MARK, OUTGOING_MARK, roofHeight } from './building-marks'

/** Arcs land this far above a roof or the ground, in u, clear of their surface. */
const ARC_LIFT = 0.1

/**
 * The links of the selected file: its linked buildings marked Marine or Sun, the arcs to them,
 * and the hubs of the bundles a click opens.
 */
export class SelectedLinks {
  private selected: number | null = null
  private links: SelectionLinks | null = null
  private shownCycle: CycleOnShow | null = null
  private marked = new Map<number, Direction>()
  private marks: BuildingMark[] = []
  private shownHubs: Hub[] = []
  private readonly roofs = new Map<number, Vec3>()

  constructor(
    private readonly layout: CityLayout,
    private readonly buildings: CityBuildings,
    private readonly imports: ImportIndex,
    private readonly overlay: Group,
    private readonly arcs: ArcLayer,
    private readonly pixelRatio: number,
  ) {}

  /** The cycle of the selected file on show, if it has one. */
  get cycle(): CycleOnShow | null {
    return this.shownCycle
  }

  /** The hubs of the bundles on show. */
  get hubs(): readonly Hub[] {
    return this.shownHubs
  }

  /** Whether this building is marked as linked to the selection. */
  isMarked(index: number): boolean {
    return this.marked.has(index)
  }

  /** The buildings linked to the selected file, none without one. */
  linked(): Set<number> {
    return this.links ? linkedBuildings(this.links, this.imports) : new Set<number>()
  }

  /** Shows the links of this file, with its cycle, or none. */
  select(index: number | null, cycle: CycleOnShow | null): void {
    this.selected = index
    this.shownCycle = cycle
    this.links =
      index === null
        ? null
        : selectionLinks(this.imports, index, (end) => this.distance(index, end))
    this.draw()
  }

  /** Opens a bundle into arcs of their own, its nearest files first; false if it is not on show. */
  open(hub: Hub): boolean {
    if (!this.links || !this.shownHubs.includes(hub)) {
      return false
    }
    const fresh = new Set(hub.bundle.ends.slice(0, OPENED_ARCS))
    this.links = openBundle(this.links, hub.bundle)
    this.draw(fresh)
    return true
  }

  dispose(): void {
    this.clearMarks()
  }

  /** Marks the linked buildings and draws the arcs; those in `fresh` were just opened out of a bundle. */
  private draw(fresh: ReadonlySet<Linked> = new Set()): void {
    this.clearMarks()
    const { links, selected } = this
    if (!links || selected === null) {
      this.marked = new Map()
      this.shownHubs = []
      this.roofs.clear()
      this.arcs.show(null)
      return
    }
    this.marked = markedBuildings(links)
    for (const [index, direction] of this.marked) {
      const mark = new BuildingMark(
        direction === 'outgoing' ? OUTGOING_MARK : INCOMING_MARK,
        this.pixelRatio,
      )
      mark.show(this.buildings.placed[index] ?? null)
      this.overlay.add(mark.group)
      this.marks.push(mark)
    }
    const { drawing, hubs } = selectionArcs(
      links,
      this.roof(selected),
      {
        arcEnd: (end) => this.place(end),
        ground: (end) => this.ground(end),
        plateau: (island) => layerAltitude(this.layout.islands[island]?.layer ?? 1),
      },
      fresh,
      this.shownCycle,
    )
    this.shownHubs = hubs
    this.arcs.show(drawing)
  }

  private clearMarks(): void {
    for (const mark of this.marks) {
      this.overlay.remove(mark.group)
      mark.dispose()
    }
    this.marks = []
  }

  /** Where an arc lands: just over a building's roof, or on the ground of a folder's grid. */
  private place(end: LinkEnd): Vec3 {
    if ('building' in end) {
      return this.roof(end.building)
    }
    const island = this.layout.islands[end.island]
    const grid = island?.grids?.[end.grid]
    if (!island || !grid) {
      return [0, 0, 0]
    }
    const { rect } = grid
    return boardToThree(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      layerAltitude(island.layer) + grid.base + ARC_LIFT,
    )
  }

  /** Over the building's highest point; kept, a selection asks for the same roofs again. */
  private roof(index: number): Vec3 {
    let roof = this.roofs.get(index)
    if (!roof) {
      const placed = this.buildings.placed[index]
      const [x, y, z] = placed?.position ?? [0, 0, 0]
      roof = [x, y + (placed ? roofHeight(placed.building) : 0) + ARC_LIFT, z]
      this.roofs.set(index, roof)
    }
    return roof
  }

  /** Where a linked end stands: a building's foot, or the middle of a folder's grid. */
  private ground(end: LinkEnd): Vec3 {
    return 'building' in end
      ? (this.buildings.placed[end.building]?.position ?? [0, 0, 0])
      : this.place(end)
  }

  /** How far a linked end stands from a building, across the ground. */
  private distance(index: number, end: LinkEnd): number {
    const [x, , z] = this.buildings.placed[index]?.position ?? [0, 0, 0]
    const there = this.ground(end)
    return Math.hypot(there[0] - x, there[2] - z)
  }
}
