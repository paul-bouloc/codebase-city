import type { CityLayout } from '../world/layout'
import type { CityTarget } from './picking'

/** The places of a city by the path of their file or folder. */
export interface CityTargets {
  /** The building of a file, the island or the parcel of a folder; null for no such path. */
  at(path: string): CityTarget | null
}

export function cityTargets(layout: CityLayout): CityTargets {
  const targets = new Map<string, CityTarget>()
  // Buildings are numbered across islands, in the order of their lots.
  let index = 0
  layout.islands.forEach((island, at) => {
    targets.set(island.path, { kind: 'island', island: at })
    island.parcels.forEach((parcel, parcelAt) => {
      if (parcel.path !== undefined && !targets.has(parcel.path)) {
        targets.set(parcel.path, { kind: 'parcel', island: at, parcel: parcelAt })
      }
    })
    for (const lot of island.lots) {
      const path = lot.file.path
      if (path) {
        targets.set(path, { kind: 'building', index })
      }
      index++
    }
  })
  return {
    at: (path) => targets.get(path) ?? null,
  }
}
