import type { CityLayout } from './layout'
import { buildingOffsets } from './selection-links'

// The import cycles around a selected file: which cycle it is part of, and one of the shortest
// loops through it, which the city draws.

/** A cycle by building index (islands in order, then lots). */
export interface Cycle {
  members: number[]
  /** One of the shortest loops through the members, in import order. */
  loop: number[]
  /** What each member imports among the others. */
  next: ReadonlyMap<number, readonly number[]>
}

export interface CycleIndex {
  cycles: Cycle[]
  /** The cycle of each building that is part of one. */
  cycleOf: ReadonlyMap<number, Cycle>
}

/** Indexes the city's cycles by building. */
export function indexCycles(layout: CityLayout): CycleIndex {
  const offsets = buildingOffsets(layout)
  const cycleOf = new Map<number, Cycle>()
  const cycles = (layout.cycles ?? []).map((found) => {
    const members = found.members.map(({ island, lot }) => (offsets[island] ?? 0) + lot)
    const next = new Map<number, number[]>()
    for (const [from, to] of found.imports) {
      const source = members[from]
      const target = members[to]
      if (source !== undefined && target !== undefined) {
        next.set(source, [...(next.get(source) ?? []), target])
      }
    }
    const cycle: Cycle = {
      members,
      loop: found.loop.flatMap((at) => members[at] ?? []),
      next,
    }
    for (const member of members) {
      cycleOf.set(member, cycle)
    }
    return cycle
  })
  return { cycles, cycleOf }
}

/**
 * One of the shortest loops through a building of the cycle, from it, in import order. A cycle
 * may close only through a barrel, which is no member: its stored loop stands in then.
 */
export function loopThrough(cycle: Cycle, building: number): number[] {
  // Breadth first from the building, until an import leads back to it.
  const before = new Map<number, number>()
  let frontier = [building]
  while (frontier.length > 0) {
    const reached: number[] = []
    for (const from of frontier) {
      for (const to of cycle.next.get(from) ?? []) {
        if (to === building) {
          const loop = [from]
          for (let at = before.get(from); at !== undefined; at = before.get(at)) {
            loop.push(at)
          }
          return loop.reverse()
        }
        if (!before.has(to)) {
          before.set(to, from)
          reached.push(to)
        }
      }
    }
    frontier = reached
  }
  return cycle.loop
}
