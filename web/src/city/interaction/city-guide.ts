import { Group } from 'three'
import type { CityBuildings } from '../buildings/buildings'
import type { Cycle } from '../flows/cycles'
import { loopDrawing } from '../flows/selection-arcs'
import { ArcLayer } from '../render/arc-mesh'
import type { IslandShape } from '../terrain/island-shape'
import type { CityLayout } from '../world/layout'
import type { Vec3 } from '../world/units'
import { type Area, AreaMark, areaOf, GUIDE_AREA } from './area-marks'
import { BuildingMark, GUIDE_MARK, GUIDE_PIN_MARK, roofHeight } from './building-marks'
import { GuideRings } from './guide-rings'
import { GuideTies, guideTies } from './guide-ties'
import { type KeptAreas, keptInAreas } from './kept-areas'
import { CYCLE_RINGS, RingSet } from './rings'
import type { CityTargets } from './targets'

// What a step of the guide's tour puts forward in the city: buildings in Jade, folders ringed in
// Jade, a cycle's loop, and what fades around them.

/** What fades: nothing, all but what is put forward, or all but the folders ringed. */
export type GuideFade = 'none' | 'all' | 'others'

/** A unit of packages a step shows, as the city holds it. */
export interface CityGuideUnit {
  /** Its islands, the largest first. */
  islands: number[]
  /** Its parcel, for a package inside another's island. */
  parcel: { island: number; parcel: number } | null
  label: GuideUnitLabel | null
}

export interface CityGuideView {
  /** Buildings in the Guide state. */
  buildings: readonly number[]
  /** Of those, the ones with a pin. */
  pinned: readonly number[]
  /** Of those, the ones whose label stands over their pin. */
  labelled: readonly number[]
  areas: readonly Area[]
  /** The units of packages on show; a unit the city shows nothing of is left out. */
  units: readonly CityGuideUnit[]
  fade: GuideFade
  cycle: Cycle | null
}

/** What the label of a unit of packages says. */
export interface GuideUnitLabel {
  name: string
  /** The line of figures over the name; none on a short label. */
  caption: string | null
}

/** A unit of packages a step shows, by path: an app, a library, a group of apps, the root. */
export interface GuideUnitPaths {
  /** Its islands or its parcel, by the path of their folder. */
  folders: readonly string[]
  /** None past the labels a step has room for: its outline says enough. */
  label: GuideUnitLabel | null
}

/** What a step puts forward, by path: what the screen knows. */
export interface GuidePaths {
  files: readonly string[]
  pinned: readonly string[]
  labelled: readonly string[]
  /** Islands or parcels, by the path of their folder. */
  folders: readonly string[]
  /** The units of packages it shows, the largest first. */
  units: readonly GuideUnitPaths[]
  fade: GuideFade
  /** The path of a file of the cycle to draw, if any. */
  cycle: string | null
}

/** The view of these paths in a city; paths the city does not show are left out. */
export function cityGuideView(
  paths: GuidePaths,
  layout: CityLayout,
  targets: CityTargets,
  cycleOf: (building: number) => Cycle | undefined,
): CityGuideView {
  const building = (path: string) => {
    const target = targets.at(path)
    return target?.kind === 'building' ? [target.index] : []
  }
  const cycleAt = paths.cycle === null ? [] : building(paths.cycle)
  return {
    buildings: paths.files.flatMap(building),
    pinned: paths.pinned.flatMap(building),
    labelled: paths.labelled.flatMap(building),
    areas: paths.folders.flatMap((path) => {
      const target = targets.at(path)
      const area = target && areaOf(layout, target)
      return area ? [area] : []
    }),
    units: paths.units.flatMap((unit) => {
      const islands: number[] = []
      let parcel: CityGuideUnit['parcel'] = null
      for (const path of unit.folders) {
        const target = targets.at(path)
        if (target?.kind === 'island') {
          islands.push(target.island)
        } else if (target?.kind === 'parcel') {
          parcel ??= { island: target.island, parcel: target.parcel }
        }
      }
      const lots = (island: number) => layout.islands[island]?.lots.length ?? 0
      islands.sort((a, b) => lots(b) - lots(a))
      return islands.length > 0 || parcel ? [{ islands, parcel, label: unit.label }] : []
    }),
    fade: paths.fade,
    cycle: cycleAt[0] === undefined ? null : (cycleOf(cycleAt[0]) ?? null),
  }
}

/** A cycle's arcs land this far above a roof, in u. */
const ROOF_LIFT = 0.1
/** A unit on more islands than this gets its outlines alone: ties and rings would net the sea. */
const MAX_MARKED_ISLANDS = 24

export class CityGuide {
  readonly group = new Group()
  /** The loop of the cycle on show. */
  readonly arcs: ArcLayer
  private view: CityGuideView | null = null
  private selected: number | null = null
  private marks: BuildingMark[] = []
  private readonly areaMarks: AreaMark[] = []
  private readonly cycleRings: RingSet
  private readonly ties: GuideTies
  private readonly rings: GuideRings

  constructor(
    private readonly layout: CityLayout,
    private readonly shapes: readonly IslandShape[],
    private readonly buildings: CityBuildings,
    private readonly pixelRatio: number,
  ) {
    this.arcs = new ArcLayer(pixelRatio)
    this.cycleRings = new RingSet(CYCLE_RINGS, pixelRatio)
    this.ties = new GuideTies(pixelRatio)
    this.rings = new GuideRings(pixelRatio)
    this.group.add(this.rings.group, this.ties.group, this.cycleRings.group, this.arcs.group)
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
    const units = view?.units ?? []
    const plateaux = (islands: readonly number[]) =>
      islands.flatMap((island) => this.layout.islands[island]?.plateau ?? [])
    const marked = units.filter((unit) => unit.islands.length <= MAX_MARKED_ISLANDS)
    this.rings.show(plateaux(marked.flatMap((unit) => unit.islands)))
    this.ties.show(marked.flatMap((unit) => guideTies(plateaux(unit.islands))))
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

  /** The roofs of the labelled buildings, where their pins stand. */
  labels(): { building: number; roof: Vec3 }[] {
    return (this.view?.labelled ?? []).map((building) => ({
      building,
      roof: this.roof(building, 0),
    }))
  }

  dispose(): void {
    this.show(null)
    this.rings.dispose()
    this.ties.dispose()
    this.cycleRings.dispose()
    this.arcs.dispose()
  }

  private markBuildings(): void {
    for (const mark of this.marks) {
      this.group.remove(mark.group)
      mark.dispose()
    }
    const pinned = new Set(this.view?.pinned ?? [])
    this.marks = (this.view?.buildings ?? []).flatMap((index) => {
      const placed = this.buildings.placed[index]
      if (!placed || index === this.selected) {
        return []
      }
      const mark = new BuildingMark(
        pinned.has(index) ? GUIDE_PIN_MARK : GUIDE_MARK,
        this.pixelRatio,
      )
      mark.show(placed)
      this.group.add(mark.group)
      return [mark]
    })
  }

  /** Over the building's highest point, `lift` u higher. */
  private roof(index: number, lift = ROOF_LIFT): Vec3 {
    const placed = this.buildings.placed[index]
    const [x, y, z] = placed?.position ?? [0, 0, 0]
    return [x, y + (placed ? roofHeight(placed.building) : 0) + lift, z]
  }
}
