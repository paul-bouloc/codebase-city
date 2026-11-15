import type { TourContext } from '../tour/tour-spans'

// How a file reaches another: the shortest ways along the imports the city draws (tests and type
// imports included, a facade like any other file), or why there is none.

/** The shortest paths counted, at most: past it, "99+", and only these are gone through. */
export const COUNTED_PATHS = 99

/** Where a file stands: its island, as its label names it, and that island's layer. */
export interface RouteEnd {
  island: string
  layer: number
}

/** Why `from` does not reach `to`: the first of these that holds. */
export type NoRouteReason =
  | { kind: 'imports-nothing' }
  | { kind: 'imported-by-nothing' }
  /** Both stand on layered islands, `from` on a lower layer. */
  | { kind: 'below'; from: RouteEnd; to: RouteEnd }
  /** How many files `from` reaches, none of them `to`. */
  | { kind: 'reaches'; files: number }

export type Route =
  | {
      kind: 'found'
      from: number
      to: number
      /** The path on show, from `from` to `to`. */
      files: readonly number[]
      /** How many shortest paths there are, up to `COUNTED_PATHS + 1` (more than counted). */
      paths: number
      /** Which of them is on show, from 0. */
      choice: number
    }
  | {
      kind: 'none'
      from: number
      to: number
      reason: NoRouteReason
      /** The steps of the shortest way back, from `to` to `from`; null if there is none. */
      back: number | null
    }

/**
 * The ways from `from` to `to`, searched once: each call gives the `choice`-th shortest path
 * (taken round the paths counted), or why there is none. The paths go in a fixed order, by the
 * paths of their files from the end back.
 */
export function routeFinder(
  context: TourContext,
  from: number,
  to: number,
): (choice: number) => Route {
  const { index } = context
  const ahead = levels(index.imports, from, to)
  if ((ahead.level[to] ?? -1) < 0) {
    const back = levels(index.imports, to, from).level[from] ?? -1
    const none: Route = {
      kind: 'none',
      from,
      to,
      reason: noRouteReason(context, from, to, ahead.reached),
      back: back < 0 ? null : back,
    }
    return () => none
  }

  // How many shortest paths lead from `from` to each file on one, `COUNTED_PATHS + 1` at most.
  const { level } = ahead
  const { importers, filePaths } = index
  const ways = new Map<number, number>([[from, 1]])
  const sorted = new Map<number, number[]>()
  const before = (file: number) => {
    let found = sorted.get(file)
    if (!found) {
      found = (importers[file] ?? [])
        .filter((importer) => level[importer] === (level[file] ?? 0) - 1)
        .sort((a, b) => (filePaths[a] ?? '').localeCompare(filePaths[b] ?? ''))
      sorted.set(file, found)
    }
    return found
  }
  const waysTo = (file: number): number => {
    const known = ways.get(file)
    if (known !== undefined) {
      return known
    }
    let count = 0
    for (const importer of before(file)) {
      count = Math.min(COUNTED_PATHS + 1, count + waysTo(importer))
    }
    ways.set(file, count)
    return count
  }
  const paths = waysTo(to)
  const counted = Math.min(paths, COUNTED_PATHS)

  // From the end back, the file before is the one whose own paths hold the one asked for.
  return (choice) => {
    const shown = ((choice % counted) + counted) % counted
    let left = shown
    const files = [to]
    for (let file = to; file !== from; ) {
      const next = before(file).find((importer) => {
        const through = waysTo(importer)
        if (left < through) {
          return true
        }
        left -= through
        return false
      })
      if (next === undefined) {
        break
      }
      file = next
      files.push(file)
    }
    return { kind: 'found', from, to, files: files.reverse(), paths, choice: shown }
  }
}

/** The `choice`-th shortest path from `from` to `to`, or why there is none (`routeFinder`). */
export function routeOf(context: TourContext, from: number, to: number, choice = 0): Route {
  return routeFinder(context, from, to)(choice)
}

/**
 * How many imports away from `from` each file stands (−1 out of reach), up to `to`'s level: the
 * files past it are left unvisited. `reached` counts the files reached, `from` left out.
 */
function levels(
  imports: readonly (readonly number[])[],
  from: number,
  to: number,
): { level: Int32Array; reached: number } {
  const level = new Int32Array(imports.length).fill(-1)
  level[from] = 0
  // Each file goes in once: the queue never outgrows the files.
  const queue = new Int32Array(imports.length)
  let length = 1
  queue[0] = from
  for (let at = 0; at < length; at++) {
    const file = queue[at] ?? 0
    const next = (level[file] ?? 0) + 1
    // Every file on `to`'s level is known once the level before it is gone through.
    if ((level[to] ?? -1) >= 0 && next > (level[to] ?? 0)) {
      break
    }
    for (const imported of imports[file] ?? []) {
      if ((level[imported] ?? 0) < 0) {
        level[imported] = next
        queue[length++] = imported
      }
    }
  }
  return { level, reached: length - 1 }
}

function noRouteReason(
  context: TourContext,
  from: number,
  to: number,
  reached: number,
): NoRouteReason {
  const { index } = context
  if ((index.imports[from] ?? []).length === 0) {
    return { kind: 'imports-nothing' }
  }
  if ((index.importers[to] ?? []).length === 0) {
    return { kind: 'imported-by-nothing' }
  }
  const [low, high] = [endOf(context, from), endOf(context, to)]
  if (low && high && low.layer < high.layer) {
    return { kind: 'below', from: low, to: high }
  }
  return { kind: 'reaches', files: reached }
}

/** The island a file stands on and its layer; null off any island or on one without a layer. */
function endOf(context: TourContext, file: number): RouteEnd | null {
  const island = context.index.islandOfFile(file)
  const layer = island === null ? null : context.index.result.islands.layer[island]
  const name = island === null ? undefined : context.islandNames[island]
  return island === null || layer === null || layer === undefined || name === undefined
    ? null
    : { island: name, layer }
}
