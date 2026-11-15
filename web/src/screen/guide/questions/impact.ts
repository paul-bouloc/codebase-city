import { islandNames } from '../../labels/area-label-texts'
import type { ResultIndex } from '../../result-index'

// What depends on a file: every file that imports it, directly or through other files, as the
// city draws its imports (tests and type imports included, a facade like any other file).

/** At most this many rows of islands; past them, one more row sums the rest. */
export const ISLAND_ROWS = 6

/** The root island's folder, named after the repository. */
const ROOT = '/'

export interface ImpactIsland {
  name: string
  count: number
}

export interface Impact {
  file: number
  /** Every file that reaches it by imports, itself left out. */
  dependents: readonly number[]
  /** Of those, the ones that import it themselves. */
  direct: number
  /** Of those, the tests. */
  tests: number
  /** The files of the city, the dependents' share is taken of. */
  files: number
  /** The islands, those with the most dependents first; at most `ISLAND_ROWS`. */
  islands: readonly ImpactIsland[]
  /** The islands past those rows, and how many dependents they hold. */
  otherIslands: { islands: number; count: number } | null
}

/** Each island's name, as its label says it: the root island bears the repository's name. */
export function impactIslandNames(index: ResultIndex): string[] {
  const paths = index.result.islands.dir.map((dir) => index.folderPaths[dir] ?? ROOT)
  const names = islandNames(paths)
  return paths.map((path, at) => (path === ROOT ? index.result.repo.name : (names[at] ?? path)))
}

/** The impact of a change to `file`, its islands named by `names`. */
export function impactOf(index: ResultIndex, names: readonly string[], file: number): Impact {
  const { importers } = index
  const seen = new Uint8Array(index.filePaths.length)
  seen[file] = 1
  const dependents: number[] = []
  for (const importer of importers[file] ?? []) {
    if (!seen[importer]) {
      seen[importer] = 1
      dependents.push(importer)
    }
  }
  const direct = dependents.length
  for (let at = 0; at < dependents.length; at++) {
    for (const importer of importers[dependents[at] ?? 0] ?? []) {
      if (!seen[importer]) {
        seen[importer] = 1
        dependents.push(importer)
      }
    }
  }

  const { scope } = index.result.files
  const counts = names.map(() => 0)
  let tests = 0
  for (const dependent of dependents) {
    if (scope[dependent] === 'test') {
      tests++
    }
    const island = index.islandOfFile(dependent)
    if (island !== null && island < counts.length) {
      counts[island] = (counts[island] ?? 0) + 1
    }
  }
  // The most dependents first: an island without any only takes a row left free, the largest
  // first.
  const sizes = names.map(() => 0)
  for (let each = 0; each < index.filePaths.length; each++) {
    const island = index.islandOfFile(each)
    if (island !== null && island < sizes.length) {
      sizes[island] = (sizes[island] ?? 0) + 1
    }
  }
  const rows = names
    .map((name, island) => ({ name, count: counts[island] ?? 0, size: sizes[island] ?? 0 }))
    .sort((a, b) => b.count - a.count || b.size - a.size || a.name.localeCompare(b.name))
    .map(({ name, count }) => ({ name, count }))
  const islands = rows.slice(0, ISLAND_ROWS)
  const rest = rows.slice(ISLAND_ROWS).filter((row) => row.count > 0)
  return {
    file,
    dependents,
    direct,
    tests,
    files: index.filePaths.length,
    islands,
    otherIslands:
      rest.length > 0
        ? { islands: rest.length, count: rest.reduce((sum, row) => sum + row.count, 0) }
        : null,
  }
}
