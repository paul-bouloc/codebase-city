import { type Building, buildingFor } from './archetypes'
import { baseTurnFor, placementFor } from './scatter'
import type { CityLayout, FileMetrics } from './world/layout'
import { boardToThree, layerAltitude, type Vec3 } from './world/units'

/** A file's building, where it stands: what the city draws and what the pointer can hit. */
export interface PlacedBuilding {
  /** Its island's index, and its lot's index on that island. */
  island: number
  lot: number
  file: FileMetrics
  building: Building
  /** The middle of its footprint on the ground, in three.js coordinates. */
  position: Vec3
  /** Turn about the vertical, in radians. */
  angle: number
}

/** Every building of the city, island by island, lot by lot. */
export function placeBuildings(layout: CityLayout): PlacedBuilding[] {
  return layout.islands.flatMap((island, islandIndex) => {
    const altitude = layerAltitude(island.layer)
    return island.lots.map((lot, lotIndex) => {
      const building = buildingFor(lot.file)
      const turn = baseTurnFor(building, lot.file.path ?? '', lot.x, lot.y, lot.grid)
      const { dx, dy, angle } = placementFor(building, lot.x, lot.y, lot.ground, turn)
      return {
        island: islandIndex,
        lot: lotIndex,
        file: lot.file,
        building,
        position: boardToThree(lot.x + dx, lot.y + dy, altitude + (lot.base ?? 0)),
        angle,
      }
    })
  })
}
