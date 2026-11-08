import { type CityLayout, rectContains } from './world/layout'

// Which files a selected file imports and which import it, and which of them get an arc of their
// own: the nearest in each direction, and every import up the layers. The others gather by island
// into a bundle, which opens on demand.

/** Arcs of their own in each direction, the nearest first, besides those going up the layers. */
export const SINGLE_ARCS = 20
/** A bundle opens into this many arcs at most, the nearest first. */
export const OPENED_ARCS = 50

/** Where an arc ends: a building, by its index in the city, or a folder's grid (a Go package). */
export type LinkEnd = { building: number } | { island: number; grid: number }

/** `outgoing`: the selection imports it. `incoming`: it imports the selection. */
export type Direction = 'outgoing' | 'incoming'

export interface Linked {
  end: LinkEnd
  /** The island it stands on. */
  island: number
  upward: boolean
}

/** Linked files of one island, drawn as one arc with their count. */
export interface Bundle {
  direction: Direction
  island: number
  /** The nearest first. */
  ends: Linked[]
  /** How many of its island's files were opened out of it already; none if absent. */
  shown?: number
}

export interface DirectionLinks {
  /** Arcs of their own. */
  single: Linked[]
  bundles: Bundle[]
}

export interface SelectionLinks {
  outgoing: DirectionLinks
  incoming: DirectionLinks
}

/** Every building's imports, both ways, by building index (islands in order, then lots). */
export interface ImportIndex {
  outgoing: Linked[][]
  incoming: Linked[][]
  /** The buildings of each imported folder's grid, by `gridKey`. */
  gridFiles: ReadonlyMap<string, readonly number[]>
}

export function gridKey(island: number, grid: number): string {
  return `${island}/${grid}`
}

/** The index of each island's first building. */
export function buildingOffsets(layout: CityLayout): number[] {
  const offsets: number[] = []
  let next = 0
  for (const island of layout.islands) {
    offsets.push(next)
    next += island.lots.length
  }
  return offsets
}

/**
 * Indexes the city's imports. An import of a folder reaches each file of that folder: those who
 * import a Go package import each of its files.
 */
export function indexImports(layout: CityLayout): ImportIndex {
  const offsets = buildingOffsets(layout)
  const count = layout.islands.reduce((sum, island) => sum + island.lots.length, 0)
  const outgoing = Array.from({ length: count }, (): Linked[] => [])
  const incoming = Array.from({ length: count }, (): Linked[] => [])
  const gridFiles = new Map<string, number[]>()
  const filesOfGrid = (island: number, grid: number): number[] => {
    const key = gridKey(island, grid)
    let files = gridFiles.get(key)
    if (!files) {
      const rect = layout.islands[island]?.grids?.[grid]?.rect
      const lots = layout.islands[island]?.lots ?? []
      files = []
      if (rect) {
        lots.forEach((lot, index) => {
          if (rectContains(rect, lot.x, lot.y)) {
            files?.push((offsets[island] ?? 0) + index)
          }
        })
      }
      gridFiles.set(key, files)
    }
    return files
  }
  // A file that imports both a package and one of its files imports that file once.
  const seen = new Set<number>()
  const reach = (source: number, target: number, link: Linked) => {
    const pair = source * count + target
    if (!seen.has(pair)) {
      seen.add(pair)
      incoming[target]?.push(link)
    }
  }
  for (const { from, to, upward } of layout.imports ?? []) {
    const source = (offsets[from.island] ?? 0) + from.lot
    const sourceLink: Linked = { end: { building: source }, island: from.island, upward }
    if ('lot' in to) {
      const target = (offsets[to.island] ?? 0) + to.lot
      outgoing[source]?.push({ end: { building: target }, island: to.island, upward })
      reach(source, target, sourceLink)
    } else {
      outgoing[source]?.push({ end: to, island: to.island, upward })
      for (const target of filesOfGrid(to.island, to.grid)) {
        reach(source, target, sourceLink)
      }
    }
  }
  return { outgoing, incoming, gridFiles }
}

/**
 * The links of a selected building: arcs of their own for every import up the layers and for
 * the `SINGLE_ARCS` nearest others in each direction; bundles by island for the rest.
 * `distance` measures how far an end is from the selection.
 */
export function selectionLinks(
  index: ImportIndex,
  building: number,
  distance: (end: LinkEnd) => number,
): SelectionLinks {
  return {
    outgoing: split(index.outgoing[building] ?? [], 'outgoing', distance),
    incoming: split(index.incoming[building] ?? [], 'incoming', distance),
  }
}

function split(
  links: readonly Linked[],
  direction: Direction,
  distance: (end: LinkEnd) => number,
): DirectionLinks {
  const single = links.filter((link) => link.upward)
  const others = nearestFirst(
    links.filter((link) => !link.upward),
    distance,
  )
  single.push(...others.slice(0, SINGLE_ARCS))
  const byIsland = new Map<number, Linked[]>()
  for (const link of others.slice(SINGLE_ARCS)) {
    const ends = byIsland.get(link.island) ?? []
    ends.push(link)
    byIsland.set(link.island, ends)
  }
  const bundles = [...byIsland].map(([island, ends]) => ({ direction, island, ends }))
  return { single, bundles }
}

function nearestFirst(links: readonly Linked[], distance: (end: LinkEnd) => number): Linked[] {
  return links
    .map((link) => ({ link, distance: distance(link.end) }))
    .sort((a, b) => a.distance - b.distance)
    .map(({ link }) => link)
}

/**
 * Opens a bundle: its `OPENED_ARCS` nearest ends get arcs of their own, and the bundle keeps the
 * rest, or goes when none is left.
 */
export function openBundle(links: SelectionLinks, opened: Bundle): SelectionLinks {
  const side = links[opened.direction]
  const bundles: Bundle[] = []
  const single = [...side.single]
  for (const bundle of side.bundles) {
    if (bundle !== opened) {
      bundles.push(bundle)
      continue
    }
    single.push(...bundle.ends.slice(0, OPENED_ARCS))
    if (bundle.ends.length > OPENED_ARCS) {
      const shown = (bundle.shown ?? 0) + OPENED_ARCS
      bundles.push({ ...bundle, ends: bundle.ends.slice(OPENED_ARCS), shown })
    }
  }
  return { ...links, [opened.direction]: { single, bundles } }
}

/**
 * The buildings at the end of an arc of their own, and how each is marked. One that both imports
 * the selection and is imported by it is marked as imported: it is what the selection needs.
 */
export function markedBuildings(links: SelectionLinks): Map<number, Direction> {
  const marked = new Map<number, Direction>()
  for (const direction of ['outgoing', 'incoming'] as const) {
    for (const { end } of links[direction].single) {
      if ('building' in end && !marked.has(end.building)) {
        marked.set(end.building, direction)
      }
    }
  }
  return marked
}

/**
 * Every building linked to the selection, with an arc of its own or in a bundle; for an imported
 * folder, each of its files.
 */
export function linkedBuildings(links: SelectionLinks, index: ImportIndex): Set<number> {
  const linked = new Set<number>()
  for (const side of [links.outgoing, links.incoming]) {
    for (const { end } of [...side.single, ...side.bundles.flatMap((bundle) => bundle.ends)]) {
      if ('building' in end) {
        linked.add(end.building)
      } else {
        for (const building of index.gridFiles.get(gridKey(end.island, end.grid)) ?? []) {
          linked.add(building)
        }
      }
    }
  }
  return linked
}
