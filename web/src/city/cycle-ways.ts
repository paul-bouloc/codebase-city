import { Group, Mesh, type ShaderMaterial } from 'three'
import { deckLine } from './bridges'
import type { ExtraFerries } from './extra-ferries'
import type { Bridge, Ferry, Pair } from './links'
import { FERRY_LINE, UPWARD } from './palette'
import { createScreenLines } from './screen-lines'
import { boardToThree, srgb, type Vec3 } from './world/units'

// A cycle that runs across islands outlines in red the bridges and ferry lines its loop takes:
// a red edge along each side of a bridge's deck, a broad red line under a ferry's. A link the
// city leaves undrawn sails out for the while, outlined the same.

/** Pairs of islands as `a/b`, `a` the lower index. */
const key = (a: number, b: number) => `${Math.min(a, b)}/${Math.max(a, b)}`

/**
 * The pairs of islands a loop of files runs between, each once, in the loop's order: from each
 * file to the next one, and from the last back to the first.
 */
export function loopIslandPairs(
  loop: readonly number[],
  islandOf: (building: number) => number | undefined,
): [number, number][] {
  const pairs = new Map<string, [number, number]>()
  if (loop.length < 2) {
    return []
  }
  loop.forEach((building, at) => {
    const from = islandOf(building)
    const to = islandOf(loop[(at + 1) % loop.length] ?? building)
    if (from !== undefined && to !== undefined && from !== to && !pairs.has(key(from, to))) {
      pairs.set(key(from, to), [Math.min(from, to), Math.max(from, to)])
    }
  })
  return [...pairs.values()]
}

/** The lines that outline a cycle's ways, in three.js coordinates. */
export interface CycleWays {
  /** The edges of its bridges' decks, red. */
  edges: Vec3[][]
  /** Its ferry lines, red under, and the line again over it. */
  ferries: Vec3[][]
}

/** Just over the deck's top, in u. */
const EDGE_RISE = 0.05
/** Under the folder's lines (0.06 u), over the ferry lines (0.04 u). */
const FERRY_ALTITUDE = 0.05

/** The ways between these pairs of islands: their bridges, ferries, or lines sailed out. */
export function cycleWays(
  pairs: readonly [number, number][],
  bridges: readonly Bridge[],
  ferries: readonly Ferry[],
  unshown: readonly Pair[],
  extra: ExtraFerries | undefined,
): CycleWays {
  const wanted = new Set(pairs.map(([a, b]) => key(a, b)))
  const ways: CycleWays = { edges: [], ferries: [] }
  const found = new Set<string>()
  for (const bridge of bridges) {
    if (wanted.has(key(bridge.a, bridge.b))) {
      found.add(key(bridge.a, bridge.b))
      for (const side of [-1, 1]) {
        const line = deckLine(bridge, (side * bridge.width) / 2, EDGE_RISE)
        ways.edges.push(line.map((point) => boardToThree(...point)))
      }
    }
  }
  const sail = (ferry: Ferry) => {
    found.add(key(ferry.a, ferry.b))
    ways.ferries.push(ferry.path.map(({ x, y }) => boardToThree(x, y, FERRY_ALTITUDE)))
  }
  for (const ferry of ferries) {
    if (wanted.has(key(ferry.a, ferry.b))) {
      sail(ferry)
    }
  }
  for (const pair of unshown) {
    const id = key(pair.a, pair.b)
    const ferry = wanted.has(id) && !found.has(id) ? extra?.route(pair) : null
    if (ferry) {
      sail(ferry)
    }
  }
  return ways
}

/** In CSS pixels; the ferry's own line over the red, and its dashes, as on the sea. */
const EDGE_WIDTH = 2.5
const FERRY_OUTLINE = 6
const FERRY_WIDTH = 2
const FERRY_DASH: [number, number] = [1.2, 0.9]
/** Over the bridges and the sea, under a folder's lines and the arcs. */
const ORDER = 5

/** The red outlines of a cycle's ways between islands. */
export class CycleWayMarks {
  readonly group = new Group()

  constructor(private readonly pixelRatio: number) {
    this.group.visible = false
  }

  /** Draws these ways, or none. */
  show(ways: CycleWays | null): void {
    this.clear()
    if (!ways) {
      return
    }
    const red = srgb(UPWARD)
    if (ways.edges.length > 0) {
      this.add(
        createScreenLines(ways.edges, { width: EDGE_WIDTH, colour: red }, this.pixelRatio, false),
        ORDER,
      )
    }
    if (ways.ferries.length > 0) {
      this.add(
        createScreenLines(
          ways.ferries,
          { width: FERRY_OUTLINE, colour: red },
          this.pixelRatio,
          false,
        ),
        ORDER,
      )
      this.add(
        createScreenLines(
          ways.ferries,
          { width: FERRY_WIDTH, colour: srgb(FERRY_LINE), sceneDash: FERRY_DASH },
          this.pixelRatio,
          false,
        ),
        ORDER + 0.5,
      )
    }
    this.group.visible = this.group.children.length > 0
  }

  dispose(): void {
    this.clear()
  }

  private add(mesh: Mesh, order: number): void {
    mesh.renderOrder = order
    this.group.add(mesh)
  }

  private clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child)
      if (child instanceof Mesh) {
        child.geometry.dispose()
        ;(child.material as ShaderMaterial).dispose()
      }
    }
    this.group.visible = false
  }
}
