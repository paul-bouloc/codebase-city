import type { CycleIndex } from '../flows/cycles'
import type { ExtraFerries } from '../flows/extra-ferries'
import type { Hub } from '../flows/selection-arcs'
import type { Direction, ImportIndex } from '../flows/selection-links'
import type { Bridge, Ferry, Pair, Port } from '../waterways/links'
import type { PortList } from './open-port'
import type { CityTarget } from './picking'

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
  /** Where the labels of the guide's step stand on the page, each time that changes. */
  guideLabels?(labels: readonly GuideLabel[]): void
  /** The labels of islands and folders on show, and where they stand, each time that changes. */
  areaLabels?(labels: readonly AreaLabel[]): void
}

/** A label of the guide over a roof: the file, and where its foot stands on the page. */
export interface GuideLabel {
  path: string
  x: number
  y: number
}

/** Which way a label runs from its anchor on screen: out to the sea, or both ways for a folder. */
export type LabelLean = 'start' | 'end' | 'centre'

/** What the label of an island or a folder says: its name, and over it a line of figures. */
export interface AreaLabelText {
  name: string
  caption: string | null
}

/** The label of an island or a folder on show, and where its anchor stands on the page. */
export interface AreaLabel {
  path: string
  island: boolean
  name: string
  /** The line of figures, when the island spans enough of the screen for it. */
  caption: string | null
  x: number
  y: number
  lean: LabelLean
}

/** A press that moves less than this, in CSS pixels, is a click, not a drag of the camera. */
const CLICK_SLOP = 4

/** Whether a press and its release, both in the page's pixels, make a click. */
export function isClick(down: { x: number; y: number }, up: { x: number; y: number }): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= CLICK_SLOP
}

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
