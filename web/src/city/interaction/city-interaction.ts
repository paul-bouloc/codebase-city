import { Group } from 'three'
import { type CityBuildings, Highlight } from '../buildings/buildings'
import { CycleWayMarks, cycleWays, loopIslandPairs } from '../flows/cycle-ways'
import { type CycleIndex, loopThrough } from '../flows/cycles'
import { type ExtraFerries, islandExtras } from '../flows/extra-ferries'
import { FolderLinkMarks, folderWays } from '../flows/folder-link-marks'
import { folderFlows } from '../flows/folder-links'
import type { CycleOnShow, Hub } from '../flows/selection-arcs'
import { type Direction, type ImportIndex, OPENED_ARCS } from '../flows/selection-links'
import { ArcLayer } from '../render/arc-mesh'
import type { Fading } from '../render/dimming'
import { easeStandard } from '../render/easing'
import type { IslandShape } from '../terrain/island-shape'
import type { Bridge, Ferry, Pair, Port } from '../waterways/links'
import { type CityLayout, rectContains } from '../world/layout'
import { type Area, AreaMark, HOVERED_AREA, SELECTED_AREA } from './area-marks'
import { BuildingMark, HOVERED_MARK, SELECTED_MARK } from './building-marks'
import { HoverTiming } from './hover-timing'
import { OpenPort, type PortList } from './open-port'
import type { CityTarget } from './picking'
import { CYCLE_RINGS, RingSet } from './rings'
import { SelectedLinks } from './selected-links'

export type { PortLinkRow, PortList } from './open-port'

/** What the pointer rests on or what is selected, with the path of its file or folder. */
export interface CityItem {
  target: CityTarget
  path: string
}

/** What a bundle's card tells: the files it holds, and what a click on it shows. */
export interface BundleCard {
  /** `outgoing`: the selection imports them; `incoming`: they import it. */
  direction: Direction
  files: number
  /** Some of its island's files were opened out of it already: these are the rest. */
  more: boolean
  /** How many arcs a click opens. */
  opens: number
}

/** A hover card to show, beside the pointer (in the page's pixels). */
export interface CityHover extends CityItem {
  pointer: { x: number; y: number }
  /** For a bundle's hub, whose item is its island. */
  bundle?: BundleCard
  /** For a port's badge, whose item is its island: how many links it gathers. */
  port?: { links: number }
}

/** How the city's files depend on each other. */
export interface CityFlows {
  imports: ImportIndex
  cycles: CycleIndex
  /** The bridges and ferry lines on show between islands. */
  bridges: readonly Bridge[]
  ferries: readonly Ferry[]
  /** The links between islands left undrawn, and how they sail out when asked for. */
  unshown?: readonly Pair[]
  extra?: ExtraFerries
  /** The ports, where an island gathers the links it has no room to draw. */
  ports?: readonly Port[]
}

/** What the pointer can rest on: a place of the city, the hub of a selection's bundle, or a port. */
export type Pointed = CityTarget | { kind: 'hub'; hub: Hub } | { kind: 'port'; port: Port }

/** Where the camera looks from, as the camera controls and the scale tell it. */
export interface CameraView {
  /** Heading in whole degrees, clockwise from north. */
  bearing: number
  /** Looking straight down. */
  topView: boolean
  /** About how many files the scale bar spans at the camera's target. */
  scaleFiles: number
}

export interface CityListeners {
  /** A card to show, or none. */
  hover?(hover: CityHover | null): void
  /** What is selected now, or nothing. */
  select?(item: CityItem | null): void
  /** The port open now, or none. */
  port?(list: PortList | null): void
  /** The camera's view, once loaded and each time it changes. */
  view?(view: CameraView): void
}

/** A press that moves less than this, in CSS pixels, is a click, not a drag of the camera. */
const CLICK_SLOP = 4

/** Whether a press and its release, both in the page's pixels, make a click. */
export function isClick(down: { x: number; y: number }, up: { x: number; y: number }): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= CLICK_SLOP
}

/** The fading in or out of what is outside the selection, in ms. */
const DIM_DURATION = 280

export function sameTarget(a: Pointed, b: Pointed): boolean {
  switch (a.kind) {
    case 'hub':
      return b.kind === 'hub' && a.hub === b.hub
    case 'port':
      return b.kind === 'port' && a.port === b.port
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
  private readonly timing: HoverTiming<Pointed>
  private highlighted: Pointed | null = null
  private selected: CityTarget | null = null
  private pointer = { x: 0, y: 0 }
  private carded: Pointed | null = null
  private dimFrom = 0
  private dimTo = 0
  private dimSince = 0
  private readonly links: SelectedLinks
  /** The rings around the files of the selected file's cycle. */
  readonly cycleRings: RingSet
  private cycle: CycleOnShow | null = null
  /** The bridges and ferry lines the loop of the selected file's cycle takes between islands. */
  readonly cycleWays: CycleWayMarks
  /** The bridges and ferry lines of a selected folder. */
  readonly folderLinks: FolderLinkMarks
  /** The ports' badges, and the lines of the one open, if any. */
  readonly portBadges: ArcLayer
  readonly portLinks: FolderLinkMarks
  private readonly ports: OpenPort

  constructor(
    private readonly layout: CityLayout,
    private readonly shapes: readonly IslandShape[],
    private readonly buildings: CityBuildings,
    private readonly flows: CityFlows,
    private readonly fading: Fading,
    pixelRatio: number,
    private readonly listeners: () => CityListeners,
    private readonly redraw: () => void,
  ) {
    this.arcs = new ArcLayer(pixelRatio)
    this.links = new SelectedLinks(
      layout,
      buildings,
      flows.imports,
      this.overlay,
      this.arcs,
      pixelRatio,
    )
    this.hoveredBuilding = new BuildingMark(HOVERED_MARK, pixelRatio)
    this.selectedBuilding = new BuildingMark(SELECTED_MARK, pixelRatio)
    this.hoveredArea = new AreaMark(HOVERED_AREA, pixelRatio)
    this.selectedArea = new AreaMark(SELECTED_AREA, pixelRatio)
    this.cycleRings = new RingSet(CYCLE_RINGS, pixelRatio)
    this.cycleWays = new CycleWayMarks(pixelRatio)
    this.folderLinks = new FolderLinkMarks(pixelRatio)
    this.ports = new OpenPort(layout, flows.ports ?? [], flows.extra, pixelRatio)
    this.portLinks = this.ports.links
    this.portBadges = this.ports.badges
    this.overlay.add(
      this.folderLinks.group,
      this.portLinks.group,
      this.portBadges.group,
      this.cycleWays.group,
      this.cycleRings.group,
      this.hoveredArea.group,
      this.selectedArea.group,
      this.hoveredBuilding.group,
      this.selectedBuilding.group,
      this.arcs.group,
    )
    this.timing = new HoverTiming<Pointed>(
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
  point(target: Pointed | null, pointer: { x: number; y: number }): void {
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
      // Nothing changes in the city, but a click on the selection is heard: it reopens its sheet.
      if (target) {
        this.listeners().select?.(this.item(target))
      }
      return
    }
    if (previous?.kind === 'building') {
      const hovered = this.highlighted && sameTarget(this.highlighted, previous)
      this.buildings.setHighlight(previous.index, hovered ? Highlight.hovered : Highlight.none)
    }
    // The hubs of the last selection go with it, and so does the card of one under the pointer.
    if (this.highlighted?.kind === 'hub') {
      this.timing.clear()
    }
    this.selected = target
    this.selectedBuilding.show(null)
    this.selectedArea.show(null, this.shapes)
    const cycle = target?.kind === 'building' ? this.flows.cycles.cycleOf.get(target.index) : null
    this.cycle =
      cycle && target?.kind === 'building'
        ? { loop: loopThrough(cycle, target.index), members: cycle.members }
        : null
    this.cycleRings.show(
      this.cycle?.members.flatMap((member) => this.buildings.placed[member] ?? []) ?? [],
    )
    this.showCycleWays()
    this.links.select(target?.kind === 'building' ? target.index : null, this.cycle)
    if (target?.kind === 'building') {
      this.buildings.setHighlight(target.index, Highlight.selected)
      this.selectedBuilding.show(this.buildings.placed[target.index] ?? null)
    } else if (target) {
      this.selectedArea.show(this.area(target), this.shapes)
    }
    this.showFolderLinks(target)
    // A hovered mark under the selected one would draw twice.
    this.highlight(this.highlighted)
    if (target) {
      this.keep(target)
    }
    this.fadeTo(target ? 1 : 0)
    this.listeners().select?.(target ? this.item(target) : null)
    this.redraw()
  }

  /** The hubs of the bundles on show, where a click opens them. */
  getHubs(): readonly Hub[] {
    return this.links.hubs
  }

  /** Opens a bundle into arcs of their own, its nearest files first: they grow out to them. */
  openHub(hub: Hub): void {
    if (!this.links.hubs.includes(hub)) {
      return
    }
    // The hub goes, or moves with what is left: its card and its rim go with it.
    this.timing.clear()
    this.links.open(hub)
    this.highlight(this.highlighted)
  }

  /** The ports whose badges the pointer can rest on and click. */
  getPorts(): readonly Port[] {
    return this.ports.ports
  }

  /** The port open, if any. */
  get openedPort(): Port | null {
    return this.ports.port
  }

  /** Opens a port, opened at this point of the page, and shows its card. */
  openPort(port: Port, pointer: { x: number; y: number } | null): void {
    if (!this.ports.canOpen(port)) {
      return
    }
    // One port at a time: the last one closes first.
    this.closePort()
    const list = this.ports.open(port, pointer)
    this.timing.clear()
    this.highlight(this.highlighted)
    this.listeners().port?.(list)
  }

  /** The open port's badge now stands here on the page, or out of the view: its card follows. */
  movePort(pointer: { x: number; y: number } | null): void {
    const list = this.ports.move(pointer)
    if (list) {
      this.listeners().port?.(list)
    }
  }

  /** One of the open port's links stands out, the others faded; or none does. */
  focusPortLink(index: number | null): void {
    if (this.ports.focus(index)) {
      this.redraw()
    }
  }

  closePort(): void {
    if (!this.ports.close()) {
      return
    }
    this.highlight(this.highlighted)
    this.listeners().port?.(null)
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

  /** Lets go of the marks; a card still shown is withdrawn, and so is an open port's. */
  dispose(): void {
    this.timing.clear()
    this.closePort()
    this.hoveredBuilding.dispose()
    this.selectedBuilding.dispose()
    this.hoveredArea.dispose()
    this.selectedArea.dispose()
    this.cycleRings.dispose()
    this.cycleWays.dispose()
    this.folderLinks.dispose()
    this.ports.dispose()
    this.links.dispose()
    this.arcs.dispose()
  }

  /** The ways the loop of the selected file's cycle takes between islands, outlined in red. */
  private showCycleWays(): void {
    const loop = this.cycle?.loop
    if (!loop) {
      this.cycleWays.show(null)
      return
    }
    const pairs = loopIslandPairs(loop, (building) => this.buildings.placed[building]?.island)
    const { bridges, ferries, unshown = [], extra } = this.flows
    this.cycleWays.show(cycleWays(pairs, bridges, ferries, unshown, extra))
  }

  /** A selected folder's bridges and ferry lines stand out; none for a file. */
  private showFolderLinks(target: CityTarget | null): void {
    if (!target || target.kind === 'building') {
      this.folderLinks.show(null)
      return
    }
    const rect =
      target.kind === 'parcel'
        ? this.layout.islands[target.island]?.parcels[target.parcel]?.rect
        : undefined
    const flows = folderFlows(this.layout, { island: target.island, ...(rect ? { rect } : {}) })
    // An island shows all its links: those left undrawn sail out too.
    const { extra, unshown = [] } = this.flows
    const extras =
      target.kind === 'island' && extra
        ? islandExtras(target.island, unshown, extra, this.getPorts())
        : []
    this.folderLinks.show(
      folderWays(target.island, flows, this.flows.bridges, [...this.flows.ferries, ...extras]),
    )
  }

  private fadeTo(value: number): void {
    if (value !== this.dimTo) {
      this.dimFrom = this.fading.dim.value
      this.dimTo = value
      // Starts at the next frame's time.
      this.dimSince = 0
    }
  }

  private highlight(pointed: Pointed | null): void {
    const previous = this.highlighted
    if (previous?.kind === 'building') {
      const selected = this.selected && sameTarget(this.selected, previous)
      this.buildings.setHighlight(previous.index, selected ? Highlight.selected : Highlight.none)
    }
    this.highlighted = pointed
    // A hovered hub rims its count, a port its badge (the open one keeps it rimmed); nothing of
    // the city stands out meanwhile.
    this.arcs.hoverLabel(pointed?.kind === 'hub' ? this.links.hubs.indexOf(pointed.hub) : null)
    const ports = this.getPorts()
    const rimmed = pointed?.kind === 'port' ? pointed.port : this.ports.port
    this.portBadges.hoverLabel(rimmed ? ports.indexOf(rimmed) : null)
    const target = pointed?.kind === 'hub' || pointed?.kind === 'port' ? null : pointed
    const selected = target && this.selected && sameTarget(target, this.selected)
    const building = target?.kind === 'building' && !selected ? target : null
    // A linked building keeps its Marine or Sun mark: it says more than the hover.
    const inked = building && !this.links.isMarked(building.index) ? building : null
    this.hoveredBuilding.show(inked ? (this.buildings.placed[inked.index] ?? null) : null)
    if (building) {
      this.buildings.setHighlight(building.index, Highlight.hovered)
    }
    const area = target && target.kind !== 'building' && !selected ? this.area(target) : null
    this.hoveredArea.show(area, this.shapes)
    this.redraw()
  }

  private emitHover(): void {
    const pointed = this.carded
    if (pointed?.kind === 'hub') {
      const { bundle } = pointed.hub
      const island: CityTarget = { kind: 'island', island: bundle.island }
      this.listeners().hover?.({
        ...this.item(island),
        pointer: this.pointer,
        bundle: {
          direction: bundle.direction,
          files: bundle.ends.length,
          more: (bundle.shown ?? 0) > 0,
          opens: Math.min(bundle.ends.length, OPENED_ARCS),
        },
      })
      return
    }
    if (pointed?.kind === 'port') {
      const { port } = pointed
      this.listeners().hover?.({
        ...this.item({ kind: 'island', island: port.island }),
        pointer: this.pointer,
        port: { links: port.pairs.length },
      })
      return
    }
    this.listeners().hover?.(pointed ? { ...this.item(pointed), pointer: this.pointer } : null)
  }

  /** The buildings and the trees that keep their colours around a selection. */
  private keep(target: CityTarget): void {
    const { placed } = this.buildings
    const area = this.fading.keptArea.value
    if (target.kind === 'building') {
      const linked = this.links.linked()
      for (const member of this.cycle?.members ?? []) {
        linked.add(member)
      }
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
