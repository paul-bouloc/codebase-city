import type { Group } from 'three'
import type { CityBuildings } from '../buildings/buildings'
import { type CycleOnShow, loopDrawing } from '../flows/selection-arcs'
import { ArcLayer } from '../render/arc-mesh'
import type { Vec3 } from '../world/units'
import { roofHeight } from './building-marks'
import { CYCLE_RINGS, RingSet } from './rings'

/** A cycle's arcs land this far above a roof, in u. */
const ROOF_LIFT = 0.1

/**
 * A cycle on its own, with no selection: a red ring around each of its files, red arcs from roof
 * to roof along one of its shortest loops, and its badge over the middle of its files.
 */
export class CycleLoop {
  /** What it draws in: its rings, then its arcs, to add to a scene. */
  readonly groups: readonly Group[]
  private readonly rings: RingSet
  private readonly arcs: ArcLayer

  constructor(
    private readonly buildings: CityBuildings,
    pixelRatio: number,
  ) {
    this.rings = new RingSet(CYCLE_RINGS, pixelRatio)
    this.arcs = new ArcLayer(pixelRatio)
    this.groups = [this.rings.group, this.arcs.group]
  }

  /** Shows this cycle, or none. */
  show(cycle: CycleOnShow | null): void {
    const { placed } = this.buildings
    this.rings.show(cycle?.members.flatMap((member) => placed[member] ?? []) ?? [])
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
  }

  dispose(): void {
    this.rings.dispose()
    this.arcs.dispose()
  }

  /** Just over the building's highest point. */
  private roof(index: number): Vec3 {
    const placed = this.buildings.placed[index]
    const [x, y, z] = placed?.position ?? [0, 0, 0]
    return [x, y + (placed ? roofHeight(placed.building) : 0) + ROOF_LIFT, z]
  }
}
