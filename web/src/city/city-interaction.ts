import { Group } from 'three'
import { ArcLayer } from './arc-mesh'
import { type Area, AreaMark, HOVERED_AREA, SELECTED_AREA } from './area-marks'
import {
  BuildingMark,
  HOVERED_MARK,
  INCOMING_MARK,
  OUTGOING_MARK,
  roofHeight,
  SELECTED_MARK,
} from './building-marks'
import { type CityBuildings, Highlight } from './buildings'
import type { Fading } from './dimming'
import { easeStandard } from './easing'
import { HoverTiming } from './hover-timing'
import type { IslandShape } from './island-shape'
import { type CityLayout, rectContains } from './layout'
import type { CityTarget } from './picking'
import { type Hub, selectionArcs } from './selection-arcs'
import {
  type Direction,
  type ImportIndex,
  type LinkEnd,
  linkedBuildings,
  markedBuildings,
  openBundle,
  type SelectionLinks,
  selectionLinks,
} from './selection-links'
import { boardToThree, layerAltitude, type Vec3 } from './units'

/** What the pointer rests on or what is selected, with the path of its file or folder. */
export interface CityItem {
  target: CityTarget
  path: string
}

/** A hover card to show, beside the pointer (in the page's pixels). */
export interface CityHover extends CityItem {
  pointer: { x: number; y: number }
}

export interface CityListeners {
  /** A card to show, or none. */
  hover?(hover: CityHover | null): void
  /** What is selected now, or nothing. */
  select?(item: CityItem | null): void
}

/** A press that moves less than this, in CSS pixels, is a click, not a drag of the camera. */
const CLICK_SLOP = 4

/** Whether a press and its release, both in the page's pixels, make a click. */
export function isClick(down: { x: number; y: number }, up: { x: number; y: number }): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= CLICK_SLOP
}

/** The fading in or out of what is outside the selection, in ms. */
const DIM_DURATION = 280
/** Arcs land this far above a roof or the ground, in u, clear of their surface. */
const ARC_LIFT = 0.1

export function sameTarget(a: CityTarget, b: CityTarget): boolean {
  switch (a.kind) {
    case 'building':
      return b.kind === 'building' && a.index === b.index
    case 'island':
      return b.kind === 'island' && a.island === b.island
    case 'parcel':
      return b.kind === 'parcel' && a.island === b.island && a.parcel === b.parcel
  }
}

/**
 * Hover and selection in one city: which building or folder stands out, its marks, and how the
 * rest fades. It draws in `overlay`; the engine feeds it what the pointer meets.
 */
export class CityInteraction {
  readonly overlay = new Group()
  /** The arcs around a selected file. */
  readonly arcs: ArcLayer
  private readonly hoveredBuilding: BuildingMark
  private readonly selectedBuilding: BuildingMark
  private readonly hoveredArea: AreaMark
  private readonly selectedArea: AreaMark
  private readonly timing: HoverTiming<CityTarget>
  private highlighted: CityTarget | null = null
  private selected: CityTarget | null = null
  private pointer = { x: 0, y: 0 }
  private carded: CityTarget | null = null
  private dimFrom = 0
  private dimTo = 0
  private dimSince = 0
  // The selected file's links, how its linked buildings are marked, and its bundles' hubs.
  private links: SelectionLinks | null = null
  private marked = new Map<number, Direction>()
  private linkMarks: BuildingMark[] = []
  private hubs: Hub[] = []
  private readonly roofs = new Map<number, Vec3>()

  constructor(
    private readonly layout: CityLayout,
    private readonly shapes: readonly IslandShape[],
    private readonly buildings: CityBuildings,
    private readonly imports: ImportIndex,
    private readonly fading: Fading,
    private readonly pixelRatio: number,
    private readonly listeners: () => CityListeners,
    private readonly redraw: () => void,
  ) {
    this.arcs = new ArcLayer(pixelRatio)
    this.hoveredBuilding = new BuildingMark(HOVERED_MARK, pixelRatio)
    this.selectedBuilding = new BuildingMark(SELECTED_MARK, pixelRatio)
    this.hoveredArea = new AreaMark(HOVERED_AREA, pixelRatio)
    this.selectedArea = new AreaMark(SELECTED_AREA, pixelRatio)
    this.overlay.add(
      this.hoveredArea.group,
      this.selectedArea.group,
      this.hoveredBuilding.group,
      this.selectedBuilding.group,
      this.arcs.group,
    )
    this.timing = new HoverTiming<CityTarget>(
      {
        highlight: (target) => this.highlight(target),
        card: (target) => {
          this.carded = target
          this.emitHover()
        },
      },
      sameTarget,
    )
  }

  /** The pointer is now on this, at this point of the page. */
  point(target: CityTarget | null, pointer: { x: number; y: number }): void {
    this.pointer = pointer
    this.timing.point(target)
    // The card follows the pointer across what it shows.
    if (this.carded && target && sameTarget(this.carded, target)) {
      this.emitHover()
    }
  }

  /** The camera moves: nothing stands out under the pointer, and no card shows. */
  clearHover(): void {
    this.timing.clear()
  }

  getSelection(): CityItem | null {
    return this.selected ? this.item(this.selected) : null
  }

  select(target: CityTarget | null): void {
    const previous = this.selected
    if (previous === target || (previous && target && sameTarget(previous, target))) {
      return
    }
    if (previous?.kind === 'building') {
      const hovered = this.highlighted && sameTarget(this.highlighted, previous)
      this.buildings.setHighlight(previous.index, hovered ? Highlight.hovered : Highlight.none)
    }
    this.selected = target
    this.selectedBuilding.show(null)
    this.selectedArea.show(null, this.shapes)
    this.links =
      target?.kind === 'building'
        ? selectionLinks(this.imports, target.index, (end) => this.distance(target.index, end))
        : null
    this.drawLinks()
    if (target?.kind === 'building') {
      this.buildings.setHighlight(target.index, Highlight.selected)
      this.selectedBuilding.show(this.buildings.placed[target.index] ?? null)
    } else if (target) {
      this.selectedArea.show(this.area(target), this.shapes)
    }
    // A hovered mark under the selected one would draw twice.
    this.highlight(this.highlighted)
    if (target) {
      this.keep(target)
    }
    this.fadeTo(target ? 1 : 0)
    this.listeners().select?.(target ? this.item(target) : null)
    this.redraw()
  }

  /** The hubs of the bundles on show, where the pointer opens them. */
  getHubs(): readonly Hub[] {
    return this.hubs
  }

  /** Opens a bundle into arcs of their own, its nearest files first. */
  openHub(hub: Hub): void {
    if (!this.links || !this.hubs.includes(hub)) {
      return
    }
    this.links = openBundle(this.links, hub.bundle)
    this.drawLinks()
    this.highlight(this.highlighted)
  }

  /** Moves the fading on; true while it still has a way to go. */
  update(now: number): boolean {
    const { dim } = this.fading
    if (dim.value === this.dimTo) {
      return false
    }
    if (this.dimSince === 0) {
      this.dimSince = now
    }
    const progress = Math.min((now - this.dimSince) / DIM_DURATION, 1)
    dim.value = this.dimFrom + (this.dimTo - this.dimFrom) * easeStandard(progress)
    if (progress >= 1) {
      dim.value = this.dimTo
    }
    return true
  }

  /** Lets go of the marks; a card still shown is withdrawn. */
  dispose(): void {
    this.timing.clear()
    this.hoveredBuilding.dispose()
    this.selectedBuilding.dispose()
    this.hoveredArea.dispose()
    this.selectedArea.dispose()
    this.clearLinkMarks()
    this.arcs.dispose()
  }

  /** Marks the linked buildings and draws the arcs of the selected file's links, if any. */
  private drawLinks(): void {
    this.clearLinkMarks()
    const links = this.links
    const selected = this.selected
    if (!links || selected?.kind !== 'building') {
      this.marked = new Map()
      this.hubs = []
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
      this.linkMarks.push(mark)
    }
    const { drawing, hubs } = selectionArcs(links, this.roof(selected.index), {
      arcEnd: (end) => this.place(end),
      ground: (end) => this.ground(end),
      plateau: (island) => layerAltitude(this.layout.islands[island]?.layer ?? 1),
    })
    this.hubs = hubs
    this.arcs.show(drawing)
  }

  private clearLinkMarks(): void {
    for (const mark of this.linkMarks) {
      this.overlay.remove(mark.group)
      mark.dispose()
    }
    this.linkMarks = []
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

  private fadeTo(value: number): void {
    if (value !== this.dimTo) {
      this.dimFrom = this.fading.dim.value
      this.dimTo = value
      // Starts at the next frame's time.
      this.dimSince = 0
    }
  }

  private highlight(target: CityTarget | null): void {
    const previous = this.highlighted
    if (previous?.kind === 'building') {
      const selected = this.selected && sameTarget(this.selected, previous)
      this.buildings.setHighlight(previous.index, selected ? Highlight.selected : Highlight.none)
    }
    this.highlighted = target
    const selected = target && this.selected && sameTarget(target, this.selected)
    const building = target?.kind === 'building' && !selected ? target : null
    // A linked building keeps its Marine or Sun mark: it says more than the hover.
    const inked = building && !this.marked.has(building.index) ? building : null
    this.hoveredBuilding.show(inked ? (this.buildings.placed[inked.index] ?? null) : null)
    if (building) {
      this.buildings.setHighlight(building.index, Highlight.hovered)
    }
    const area = target && target.kind !== 'building' && !selected ? this.area(target) : null
    this.hoveredArea.show(area, this.shapes)
    this.redraw()
  }

  private emitHover(): void {
    const target = this.carded
    this.listeners().hover?.(target ? { ...this.item(target), pointer: this.pointer } : null)
  }

  /** The buildings and the trees that keep their colours around a selection. */
  private keep(target: CityTarget): void {
    const { placed } = this.buildings
    const area = this.fading.keptArea.value
    if (target.kind === 'building') {
      const linked = this.links ? linkedBuildings(this.links) : new Set<number>()
      this.buildings.setKept((index) => index === target.index || linked.has(index))
      area.set(1, 1, 0, 0)
      return
    }
    const island = this.layout.islands[target.island]
    const rect = target.kind === 'parcel' ? island?.parcels[target.parcel]?.rect : island?.plateau
    if (!island || !rect) {
      return
    }
    this.buildings.setKept((index) => {
      const building = placed[index]
      const lot = building && building.island === target.island ? island.lots[building.lot] : null
      return lot !== null && lot !== undefined && rectContains(rect, lot.x, lot.y)
    })
    // An island's trees stand on its flanks too, down to its beach.
    const margin = target.kind === 'island' ? (this.shapes[target.island]?.reach ?? 0) : 0
    // Board y runs along three.js −z.
    area.set(
      rect.x - margin,
      -(rect.y + rect.height) - margin,
      rect.x + rect.width + margin,
      -rect.y + margin,
    )
  }

  private area(target: CityTarget): Area | null {
    if (target.kind === 'island') {
      return { island: target.island }
    }
    if (target.kind === 'parcel') {
      const parcel = this.layout.islands[target.island]?.parcels[target.parcel]
      return parcel ? { island: target.island, rect: parcel.rect, level: parcel.level } : null
    }
    return null
  }

  private item(target: CityTarget): CityItem {
    return { target, path: targetPath(this.layout, this.buildings, target) }
  }
}

function targetPath(layout: CityLayout, buildings: CityBuildings, target: CityTarget) {
  switch (target.kind) {
    case 'building':
      return buildings.placed[target.index]?.file.path ?? ''
    case 'island':
      return layout.islands[target.island]?.path ?? ''
    case 'parcel':
      return layout.islands[target.island]?.parcels[target.parcel]?.path ?? ''
  }
}
