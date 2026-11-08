import { describe, expect, it } from 'vitest'
import { createBuildings } from './buildings'
import { islandShapes } from './terrain/island-shape'
import { createSea } from './terrain/sea'
import { createTerrain } from './terrain/terrain'
import { boundsOf, type CityLayout } from './world/layout'

const EMPTY: CityLayout = { islands: [], bounds: boundsOf([]) }

// A repository with nothing the analysis could place still gets a sea.
describe('an empty city', () => {
  it('builds every layer without throwing', () => {
    expect(() => createSea(EMPTY)).not.toThrow()
    expect(() => createTerrain(islandShapes(EMPTY))).not.toThrow()
    expect(() => createBuildings(EMPTY, 1)).not.toThrow()
  })
})
