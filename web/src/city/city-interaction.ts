import { Group } from 'three'
import { ArcLayer } from './arc-mesh'
import { type Area, AreaMark, HOVERED_AREA, SELECTED_AREA } from './area-marks'
import {
  BuildingMark,
  CYCLE_RINGS,
  HOVERED_MARK,
  INCOMING_MARK,
  OUTGOING_MARK,
  RingSet,
  roofHeight,
  SELECTED_MARK,
} from './building-marks'
import { type CityBuildings, Highlight } from './buildings'
import { CycleWayMarks, cycleWays, loopIslandPairs } from './cycle-ways'
import { type CycleIndex, loopThrough } from './cycles'
import type { Fading } from './dimming'
import { easeStandard } from './easing'
import { type ExtraFerries, islandExtras } from './extra-ferries'
import { FolderLinkMarks, folderWays } from './folder-link-marks'
import { folderFlows } from './folder-links'
import { HoverTiming } from './hover-timing'
import type { IslandShape } from './island-shape'
import { type CityLayout, rectContains } from './layout'
import type { Bridge, Ferry, Pair, Port } from './links'
import type { CityTarget } from './picking'
import { PORT_ROWS, portLabels, portRows } from './port-links'
import { type CycleOnShow, type Hub, selectionArcs } from './selection-arcs'
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
} from './selection-links'
import { boardToThree, layerAltitude, type Vec3 } from './units'

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

/** A link of an open port, as its card lists it. */
export interface PortLinkRow {
  /** The island across. */
  path: string
  imports: number
  /** The port's island imports the other one. */
  outgoing: boolean
  /** The other island imports the port's. */
  incoming: boolean
}

/** An open port's card: its island, its links (the largest, `PORT_ROWS` at most) and the rest. */
export interface PortList {
  path: string
  links: PortLinkRow[]
  /** Links past those listed. */
  more: number
  /** Where it was opened, in the page's pixels. */
  pointer: { x: number; y: number }
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

export interface CityListeners {
  /** A card to show, or none. */
  hover?(hover: CityHover | null): void
  /** What is selected now, or nothing. */
  select?(item: CityItem | null): void
  /** The port open now, or none. */
  port?(list: PortList | null): void
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
  // The selected file's links, how its linked buildings are marked, and its bundles' hubs.
  private links: SelectionLinks | null = null
  private marked = new Map<number, Direction>()
  private linkMarks: BuildingMark[] = []
  private hubs: Hub[] = []
  private readonly roofs = new Map<number, Vec3>()
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
  private openPortAt: Port | null = null
  private portFerries: { outgoing: boolean; incoming: boolean; ferry: Ferry | null }[] = []

  constructor(
    private readonly layout: CityLayout,
    private readonly shapes: readonly IslandShape[],
    private readonly buildings: CityBuildings,
    private readonly flows: CityFlows,
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
    this.cycleRings = new RingSet(CYCLE_RINGS, pixelRatio)
    this.cycleWays = new CycleWayMarks(pixelRatio)
    this.folderLinks = new FolderLinkMarks(pixelRatio)
    this.portLinks = new FolderLinkMarks(pixelRatio)
    this.portBadges = new ArcLayer(pixelRatio)
    this.portBadges.show({ lines: [], dots: [], stems: [], labels: portLabels(flows.ports ?? []) })
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
    this.links =
      target?.kind === 'building'
        ? selectionLinks(this.flows.imports, target.index, (end) =>
            this.distance(target.index, end),
          )
        : null
    const cycle = target?.kind === 'building' ? this.flows.cycles.cycleOf.get(target.index) : null
    this.cycle =
      cycle && target?.kind === 'building'
        ? { loop: loopThrough(cycle, target.index), members: cycle.members }
        : null
    this.cycleRings.show(
      this.cycle?.members.flatMap((member) => this.buildings.placed[member] ?? []) ?? [],
    )
    this.showCycleWays()
    this.drawLinks()
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
    return this.hubs
  }

  /** Opens a bundle into arcs of their own, its nearest files first: they grow out to them. */
  openHub(hub: Hub): void {
    if (!this.links || !this.hubs.includes(hub)) {
      return
    }
    const fresh = new Set(hub.bundle.ends.slice(0, OPENED_ARCS))
    this.links = openBundle(this.links, hub.bundle)
    // The hub goes, or moves with what is left: its card and its rim go with it.
    this.timing.clear()
    this.drawLinks(fresh)
    this.highlight(this.highlighted)
  }

  /** The ports whose badges the pointer can rest on and click. */
  getPorts(): readonly Port[] {
    return this.flows.ports ?? []
  }

  /** The port open, if any. */
  get openedPort(): Port | null {
    return this.openPortAt
  }

  /**
   * Opens a port, opened at this point of the page: its links sail out of its quay, Marine where
   * its island imports the other one, Sun the other way, and its card lists them.
   */
  openPort(port: Port, pointer: { x: number; y: number }): void {
    const { extra } = this.flows
    if (!extra || !this.getPorts().includes(port)) {
      return
    }
    const links = this.layout.links ?? []
    const rows = portRows(port, links)
    this.openPortAt = port
    this.portFerries = rows.map((row, at) => {
      const pair = port.pairs[at]
      return {
        outgoing: row.outgoing,
        incoming: row.incoming,
        ferry: pair ? extra.route(pair, port) : null,
      }
    })
    this.drawPort(null)
    this.timing.clear()
    this.highlight(this.highlighted)
    this.listeners().port?.({
      path: this.layout.islands[port.island]?.path ?? '',
      links: rows.slice(0, PORT_ROWS).map((row) => ({
        path: this.layout.islands[row.island]?.path ?? '',
        imports: row.imports,
        outgoing: row.outgoing,
        incoming: row.incoming,
      })),
      more: Math.max(rows.length - PORT_ROWS, 0),
      pointer,
    })
  }

  /** One of the open port's links stands out, the others faded; or none does. */
  focusPortLink(index: number | null): void {
    if (this.openPortAt) {
      this.drawPort(index)
      this.redraw()
    }
  }

  closePort(): void {
    if (!this.openPortAt) {
      return
    }
    this.openPortAt = null
    this.portFerries = []
    this.portLinks.show(null)
    this.highlight(this.highlighted)
    this.listeners().port?.(null)
  }

  /** The open port's lines, `focus` the index of the one that stands out. */
  private drawPort(focus: number | null): void {
    const port = this.openPortAt
    if (!port) {
      this.portLinks.show(null)
      return
    }
    const ways = (lines: typeof this.portFerries) => {
      const flows = new Map<number, { outgoing: boolean; incoming: boolean }>()
      const ferries: Ferry[] = []
      for (const { ferry, outgoing, incoming } of lines) {
        if (ferry) {
          flows.set(ferry.a === port.island ? ferry.b : ferry.a, { outgoing, incoming })
          ferries.push(ferry)
        }
      }
      return folderWays(port.island, flows, [], ferries)
    }
    const focused = focus === null ? undefined : this.portFerries[focus]
    this.portLinks.show(ways(this.portFerries), focused ? ways([focused]) : null)
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
    this.portLinks.dispose()
    this.portBadges.dispose()
    this.clearLinkMarks()
    this.arcs.dispose()
  }

  /**
   * Marks the linked buildings and draws the arcs of the selected file's links, if any; those in
   * `fresh` were just opened out of a bundle.
   */
  private drawLinks(fresh: ReadonlySet<Linked> = new Set()): void {
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
    const { drawing, hubs } = selectionArcs(
      links,
      this.roof(selected.index),
      {
        arcEnd: (end) => this.place(end),
        ground: (end) => this.ground(end),
        plateau: (island) => layerAltitude(this.layout.islands[island]?.layer ?? 1),
      },
      fresh,
      this.cycle,
    )
    this.hubs = hubs
    this.arcs.show(drawing)
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
      target.kind === 'island' && extra ? islandExtras(target.island, unshown, extra) : []
    this.folderLinks.show(
      folderWays(target.island, flows, this.flows.bridges, [...this.flows.ferries, ...extras]),
    )
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

  private highlight(pointed: Pointed | null): void {
    const previous = this.highlighted
    if (previous?.kind === 'building') {
      const selected = this.selected && sameTarget(this.selected, previous)
      this.buildings.setHighlight(previous.index, selected ? Highlight.selected : Highlight.none)
    }
    this.highlighted = pointed
    // A hovered hub rims its count, a port its badge (the open one keeps it rimmed); nothing of
    // the city stands out meanwhile.
    this.arcs.hoverLabel(pointed?.kind === 'hub' ? this.hubs.indexOf(pointed.hub) : null)
    const ports = this.getPorts()
    const rimmed = pointed?.kind === 'port' ? pointed.port : this.openPortAt
    this.portBadges.hoverLabel(rimmed ? ports.indexOf(rimmed) : null)
    const target = pointed?.kind === 'hub' || pointed?.kind === 'port' ? null : pointed
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
      const linked = this.links
        ? linkedBuildings(this.links, this.flows.imports)
        : new Set<number>()
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
