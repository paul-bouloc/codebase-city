import { Group } from 'three'
import type { CityBuildings } from '../buildings/buildings'
import type { Cycle } from '../flows/cycles'
import { loopDrawing } from '../flows/selection-arcs'
import { ArcLayer } from '../render/arc-mesh'
import type { IslandShape } from '../terrain/island-shape'
import type { CityLayout } from '../world/layout'
import type { Vec3 } from '../world/units'
import { type Area, AreaMark, GUIDE_AREA } from './area-marks'
import { BuildingMark, GUIDE_MARK, GUIDE_PIN_MARK, roofHeight } from './building-marks'
import { type KeptAreas, keptInAreas } from './kept-areas'
import { CYCLE_RINGS, RingSet } from './rings'

// What a step of the guide's tour puts forward in the city: buildings in Jade, folders ringed in
// Jade, a cycle's loop, and what fades around them.

/** What fades: nothing, all but what is put forward, or all but the folders ringed. */
export type GuideFade = 'none' | 'all' | 'others'

export interface CityGuideView {
  /** Buildings in the Guide state. */
  buildings: readonly number[]
  /** Of those, the ones whose label stands over their roof: they carry a pin. */
  labelled: readonly number[]
  areas: readonly Area[]
  fade: GuideFade
  cycle: Cycle | null
}

/** Arcs and labels land this far above a roof, in u. */
const ROOF_LIFT = 0.1

export class CityGuide {
  readonly group = new Group()
  /** The loop of the cycle on show. */
  readonly arcs: ArcLayer
  private view: CityGuideView | null = null
  private selected: number | null = null
  private marks: BuildingMark[] = []
  private readonly areaMarks: AreaMark[] = []
  private readonly cycleRings: RingSet

  constructor(
    private readonly layout: CityLayout,
    private readonly shapes: readonly IslandShape[],
    private readonly buildings: CityBuildings,
    private readonly pixelRatio: number,
  ) {
    this.arcs = new ArcLayer(pixelRatio)
    this.cycleRings = new RingSet(CYCLE_RINGS, pixelRatio)
    this.group.add(this.cycleRings.group, this.arcs.group)
  }

  get shown(): CityGuideView | null {
    return this.view
  }

  /** Shows what a step puts forward, or nothing. */
  show(view: CityGuideView | null): void {
    this.view = view
    for (const mark of this.areaMarks) {
      this.group.remove(mark.group)
      mark.dispose()
    }
    this.areaMarks.length = 0
    for (const area of view?.areas ?? []) {
      const mark = new AreaMark(GUIDE_AREA, this.pixelRatio)
      mark.show(area, this.shapes)
      this.areaMarks.push(mark)
      this.group.add(mark.group)
    }
    const { placed } = this.buildings
    const cycle = view?.cycle ?? null
    this.cycleRings.show(cycle?.members.flatMap((member) => placed[member] ?? []) ?? [])
    this.arcs.show(
      cycle
        ? loopDrawing(
            cycle.loop.map((building) => this.roof(building)),
            cycle.members,
            (end) =>
              'building' in end ? (placed[end.building]?.position ?? [0, 0, 0]) : [0, 0, 0],
          )
        : null,
    )
    this.markBuildings()
  }

  /** The selected building, if any: its own marks stand in place of the guide's. */
  setSelected(index: number | null): void {
    if (index !== this.selected) {
      this.selected = index
      this.markBuildings()
    }
  }

  /** Whether this building is in the Guide state. */
  has(index: number): boolean {
    return this.view?.buildings.includes(index) ?? false
  }

  /** What keeps its colours while the rest fades; null when nothing fades. */
  kept(): KeptAreas | null {
    const view = this.view
    if (!view || view.fade === 'none') {
      return null
    }
    if (view.fade === 'others' && view.areas.length > 0) {
      const inAreas = keptInAreas(this.layout, this.buildings.placed, this.shapes, view.areas)
      const shown = new Set(view.buildings)
      return { ...inAreas, kept: (index) => shown.has(index) || inAreas.kept(index) }
    }
    const shown = new Set([...view.buildings, ...(view.cycle?.members ?? [])])
    return { kept: (index) => shown.has(index), trees: [1, 1, 0, 0] }
  }

  /** Where the labels stand: just over the labelled roofs. */
  labels(): { building: number; roof: Vec3 }[] {
    return (this.view?.labelled ?? []).map((building) => ({ building, roof: this.roof(building) }))
  }

  dispose(): void {
    this.show(null)
    this.cycleRings.dispose()
    this.arcs.dispose()
  }

  private markBuildings(): void {
    for (const mark of this.marks) {
      this.group.remove(mark.group)
      mark.dispose()
    }
    const labelled = new Set(this.view?.labelled ?? [])
    this.marks = (this.view?.buildings ?? []).flatMap((index) => {
      const placed = this.buildings.placed[index]
      if (!placed || index === this.selected) {
        return []
      }
      const mark = new BuildingMark(
        labelled.has(index) ? GUIDE_PIN_MARK : GUIDE_MARK,
        this.pixelRatio,
      )
      mark.show(placed)
      this.group.add(mark.group)
      return [mark]
    })
  }

  private roof(index: number): Vec3 {
    const placed = this.buildings.placed[index]
    const [x, y, z] = placed?.position ?? [0, 0, 0]
    return [x, y + (placed ? roofHeight(placed.building) : 0) + ROOF_LIFT, z]
  }
}
