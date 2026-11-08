import type { PlacedBuilding } from '../buildings/placed-buildings'
import type { IslandShape } from '../terrain/island-shape'
import { type CityLayout, rectContains } from '../world/layout'
import type { Area } from './area-marks'

// What keeps its colours when the city fades around some folders: their buildings, and the trees
// of a box around them.

export interface KeptAreas {
  kept: (index: number) => boolean
  /** The box the trees are kept in: x and z of three.js, min then max. */
  trees: [number, number, number, number]
}

/** The buildings standing in these folders, and the box around them, an island's flanks included. */
export function keptInAreas(
  layout: CityLayout,
  placed: readonly (PlacedBuilding | undefined)[],
  shapes: readonly IslandShape[],
  areas: readonly Area[],
): KeptAreas {
  const rects = areas.flatMap((area) => {
    const island = layout.islands[area.island]
    const rect = 'rect' in area ? area.rect : island?.plateau
    // An island's trees stand on its flanks too, down to its beach.
    const margin = 'rect' in area ? 0 : (shapes[area.island]?.reach ?? 0)
    return island && rect ? [{ island: area.island, rect, margin }] : []
  })
  const kept = (index: number) => {
    const building = placed[index]
    const lot = building ? layout.islands[building.island]?.lots[building.lot] : undefined
    return (
      building !== undefined &&
      lot !== undefined &&
      rects.some(
        ({ island, rect }) => island === building.island && rectContains(rect, lot.x, lot.y),
      )
    )
  }
  if (rects.length === 0) {
    return { kept, trees: [1, 1, 0, 0] }
  }
  // Board y runs along three.js −z.
  const trees: KeptAreas['trees'] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]
  for (const { rect, margin } of rects) {
    trees[0] = Math.min(trees[0], rect.x - margin)
    trees[1] = Math.min(trees[1], -(rect.y + rect.height) - margin)
    trees[2] = Math.max(trees[2], rect.x + rect.width + margin)
    trees[3] = Math.max(trees[3], -rect.y + margin)
  }
  return { kept, trees }
}
