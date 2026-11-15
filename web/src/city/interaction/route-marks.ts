import { Group } from 'three'
import type { CityBuildings } from '../buildings/buildings'
import { routeDrawing } from '../flows/selection-arcs'
import { ArcLayer } from '../render/arc-mesh'
import type { Vec3 } from '../world/units'
import { BuildingMark, OUTGOING_MARK, ROUTE_END_MARK, roofPoint } from './building-marks'

/** Arcs land this far above a roof, in u, clear of it. */
const ARC_LIFT = 0.1

/**
 * A route of the guide in the city: its two ends in ink, the files between outlined in Marine,
 * and a Marine arc from each roof to the next.
 */
export class RouteMarks {
  readonly group = new Group()
  readonly arcs: ArcLayer
  private files: readonly number[] = []
  private marks: BuildingMark[] = []

  constructor(
    private readonly buildings: CityBuildings,
    private readonly pixelRatio: number,
  ) {
    this.arcs = new ArcLayer(pixelRatio)
    this.group.add(this.arcs.group)
  }

  /** Whether this building is on the route on show. */
  has(index: number): boolean {
    return this.files.includes(index)
  }

  /** Shows this route, in import order, or none; the selected building keeps its own mark. */
  show(files: readonly number[] | null, selected: number | null): void {
    this.clearMarks()
    this.files = files ?? []
    this.files.forEach((index, at) => {
      if (index === selected) {
        return
      }
      const end = at === 0 || at === this.files.length - 1
      const mark = new BuildingMark(end ? ROUTE_END_MARK : OUTGOING_MARK, this.pixelRatio)
      mark.show(this.buildings.placed[index] ?? null)
      this.group.add(mark.group)
      this.marks.push(mark)
    })
    this.arcs.show(
      this.files.length > 1
        ? routeDrawing(this.files.map((index) => this.roof(index, ARC_LIFT)))
        : null,
    )
  }

  /** Each file of the route and the point over its roof where its number stands, in order. */
  stops(): { building: number; roof: Vec3; free: true }[] {
    return this.files.map((building) => ({ building, roof: this.roof(building, 0), free: true }))
  }

  dispose(): void {
    this.clearMarks()
    this.arcs.dispose()
  }

  private roof(index: number, lift: number): Vec3 {
    return roofPoint(this.buildings.placed[index], lift)
  }

  private clearMarks(): void {
    for (const mark of this.marks) {
      this.group.remove(mark.group)
      mark.dispose()
    }
    this.marks = []
  }
}
