import { Group } from 'three'
import { createBuildings } from '../buildings/buildings'
import type { PlacedBuilding } from '../buildings/placed-buildings'
import { cityDecor } from '../decor/decor'
import { createDecor, type DecorStats, decorStats } from '../decor/decor-mesh'
import { Fleet } from '../decor/fleet'
import { indexCycles } from '../flows/cycles'
import { ExtraFerries } from '../flows/extra-ferries'
import { indexImports } from '../flows/selection-links'
import { CityInteraction, type CityListeners } from '../interaction/city-interaction'
import { CityPicker } from '../interaction/picking'
import { type CityTargets, cityTargets } from '../interaction/targets'
import { createFading } from '../render/dimming'
import { islandShapes } from '../terrain/island-shape'
import { createParcels } from '../terrain/plateaux'
import { createSea } from '../terrain/sea'
import { createTerrain } from '../terrain/terrain'
import { createBridges } from '../waterways/bridges'
import { createFerries } from '../waterways/ferries'
import { cityLinks } from '../waterways/links'
import type { CityLayout } from '../world/layout'
import type { LinkStats } from './frame-stats'

/** Everything a city on show is made of, and what the engine keeps of it. */
export interface CityScene {
  group: Group
  interaction: CityInteraction
  fleet: Fleet
  picker: CityPicker
  targets: CityTargets
  placed: readonly PlacedBuilding[]
  decor: DecorStats
  links: LinkStats
  /** Files per square unit of the plateaux, for the scale. */
  density: number
  /** The height of the highest plateau. */
  top: number
}

/** Builds the meshes and the interaction of a city from its layout. */
export function buildCity(
  layout: CityLayout,
  pixelRatio: number,
  listeners: () => CityListeners,
  requestRender: () => void,
): CityScene {
  const shapes = islandShapes(layout)
  const links = cityLinks(layout, shapes)
  const decor = cityDecor(layout, shapes, links)
  const fading = createFading()
  const buildings = createBuildings(layout, pixelRatio, fading)
  const fleet = new Fleet(
    links.boats.filter((boat) => boat.line),
    links.ferries,
    fading,
  )
  const files = layout.islands.reduce((sum, island) => sum + island.lots.length, 0)
  const area = layout.islands.reduce((sum, { plateau }) => sum + plateau.width * plateau.height, 0)
  const interaction = new CityInteraction(
    layout,
    shapes,
    buildings,
    {
      imports: indexImports(layout),
      cycles: indexCycles(layout),
      bridges: links.bridges,
      ferries: links.ferries,
      unshown: links.unshown,
      extra: new ExtraFerries(layout, shapes, links),
      ports: links.ports,
    },
    fading,
    pixelRatio,
    listeners,
    requestRender,
  )
  const group = new Group().add(
    createSea(
      layout,
      shapes.map((shape) => shape.reach),
    ),
    createTerrain(shapes),
    createParcels(layout, decor.gardens),
    createBridges(links),
    createFerries(links.ferries, pixelRatio),
    buildings.group,
    createDecor(
      decor,
      links.boats.filter((boat) => !boat.line),
      fading,
    ),
    fleet.mesh,
  )
  return {
    group,
    interaction,
    fleet,
    picker: new CityPicker(shapes, buildings.placed),
    targets: cityTargets(layout),
    placed: buildings.placed,
    decor: decorStats(decor, links.boats),
    links: {
      bridges: links.bridges.length,
      ferries: links.ferries.length,
      inPorts: links.inPorts,
      hidden: links.hidden,
    },
    density: area > 0 ? files / area : 0,
    top: shapes.reduce((high, { altitudes }) => Math.max(high, altitudes[0] ?? 0), 0),
  }
}
