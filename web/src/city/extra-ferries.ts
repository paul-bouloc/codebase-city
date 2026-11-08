import {
  type CityLinks,
  type Ferry,
  type Pair,
  type Port,
  passingPier,
  type Quay,
  tipOf,
} from './links'
import type { IslandShape } from './terrain/island-shape'
import { ferryRoute, type WaterGrid, waterGrid } from './water-route'
import { boundsOf, type CityLayout, type Point } from './world/layout'

// The island links a city leaves undrawn, at a port or too small, sail out for a while when they
// are asked for: from the port's quay, or from the beach of the side turned toward the other
// island. They are routed on the water once, then kept, and weigh on nothing: a line comes out
// the same whatever was shown before it.

export class ExtraFerries {
  private grid: WaterGrid | null
  private readonly routes = new Map<string, Ferry | null>()

  constructor(
    private readonly layout: CityLayout,
    private readonly shapes: readonly IslandShape[],
    private readonly links: Pick<CityLinks, 'bridges' | 'quays' | 'grid'>,
  ) {
    this.grid = links.grid
  }

  /**
   * The line of an undrawn pair, from the quay of the port that gathers it if given, by water;
   * null if there is no way.
   */
  route(pair: Pair, port?: { island: number; quay: Quay }): Ferry | null {
    const from = port?.island ?? pair.a
    const to = from === pair.a ? pair.b : pair.a
    const key = `${pair.a}/${pair.b}/${port ? `port ${from}` : ''}`
    if (this.routes.has(key)) {
      return this.routes.get(key) ?? null
    }
    const ferry = this.sail(pair, from, to, port?.quay ?? null)
    this.routes.set(key, ferry)
    return ferry
  }

  private sail(pair: Pair, from: number, to: number, quay: Quay | null): Ferry | null {
    const start = quay ?? passingPier(this.layout, this.shapes, this.links, from, to)
    const end = passingPier(this.layout, this.shapes, this.links, to, from)
    if (!start || !end) {
      return null
    }
    this.grid ??= waterGrid(
      this.shapes,
      boundsOf(this.layout.islands.map((island) => island.plateau)),
    )
    const path = ferryRoute(
      this.grid,
      tipOf(start),
      { x: start.nx, y: start.ny },
      tipOf(end),
      { x: end.nx, y: end.ny },
      false,
    )
    if (!path) {
      return null
    }
    // No pier is built for it: the line comes ashore at the beach. A port's quay is there.
    const ashore = (pier: Quay): Point => ({ x: pier.x, y: pier.y })
    const line = [...(quay ? [] : [ashore(start)]), ...path, ashore(end)]
    // From `a` to `b`, as every ferry runs.
    return { ...pair, path: from === pair.a ? line : line.reverse() }
  }
}

/**
 * The undrawn links of an island, sailed out: those gathered at its port from the port's quay, as
 * when the port is open, the others from its side; those a way by water was found for.
 */
export function islandExtras(
  island: number,
  unshown: readonly Pair[],
  extra: ExtraFerries,
  ports: readonly Port[] = [],
): Ferry[] {
  const port = ports.find((each) => each.island === island)
  const atPort = new Set(port?.pairs)
  return unshown
    .filter((pair) => pair.a === island || pair.b === island)
    .flatMap((pair) => {
      const ferry = extra.route(pair, port && atPort.has(pair) ? port : undefined)
      return ferry ? [ferry] : []
    })
}
