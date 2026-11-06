import { Group } from 'three'
import { type Area, AreaMark, HOVERED_AREA, SELECTED_AREA } from './area-marks'
import { BuildingMark, HOVERED_MARK, SELECTED_MARK } from './building-marks'
import { type CityBuildings, Highlight } from './buildings'
import type { Fading } from './dimming'
import { easeStandard } from './easing'
import { HoverTiming } from './hover-timing'
import type { IslandShape } from './island-shape'
import { type CityLayout, rectContains } from './layout'
import type { CityTarget } from './picking'

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

/** The fading in or out of what is outside the selection, in ms. */
const DIM_DURATION = 280

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

  constructor(
    private readonly layout: CityLayout,
    private readonly shapes: readonly IslandShape[],
    private readonly buildings: CityBuildings,
    private readonly fading: Fading,
    pixelRatio: number,
    private readonly listeners: () => CityListeners,
    private readonly redraw: () => void,
  ) {
    this.hoveredBuilding = new BuildingMark(HOVERED_MARK, pixelRatio)
    this.selectedBuilding = new BuildingMark(SELECTED_MARK, pixelRatio)
    this.hoveredArea = new AreaMark(HOVERED_AREA, pixelRatio)
    this.selectedArea = new AreaMark(SELECTED_AREA, pixelRatio)
    this.overlay.add(
      this.hoveredArea.group,
      this.selectedArea.group,
      this.hoveredBuilding.group,
      this.selectedBuilding.group,
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

  dispose(): void {
    this.timing.clear()
    this.hoveredBuilding.dispose()
    this.selectedBuilding.dispose()
    this.hoveredArea.dispose()
    this.selectedArea.dispose()
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
    this.hoveredBuilding.show(building ? (this.buildings.placed[building.index] ?? null) : null)
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
      this.buildings.setKept((index) => index === target.index)
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
