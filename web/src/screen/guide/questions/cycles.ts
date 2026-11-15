import type { TourContext } from '../tour/tour-spans'

// The import cycles of a city, as the analysis found them: groups of production files each of
// which reaches all the others by its imports. Listed the biggest first, each named by the
// folders that hold most of it.

/** The rows of the list shown before "Show all". */
export const SHOWN_CYCLES = 6

export interface CycleRow {
  /** Its row of the result's `cycles`. */
  row: number
  /** Its files, sorted. */
  members: readonly number[]
  /** One of the shortest loops through them, in import order. */
  loop: readonly number[]
  /** The one or two folders that hold most of its files, from their island's name. */
  folders: readonly string[]
}

export interface CycleList {
  /** The biggest first, then by their folders. */
  cycles: readonly CycleRow[]
  /** The files in a cycle. */
  files: number
}

/** The city's cycles, the biggest first, named by their folders. */
export function cycleList(context: TourContext): CycleList {
  const { index } = context
  const { members, shortest } = index.result.cycles
  const cycles = members
    .map((files, row) => ({
      row,
      members: files,
      loop: shortest[row] ?? [],
      folders: mainFolders(context, files),
    }))
    .sort(
      (a, b) =>
        b.members.length - a.members.length ||
        compare(a.folders.join('\n'), b.folders.join('\n')) ||
        a.row - b.row,
    )
  return { cycles, files: members.reduce((sum, files) => sum + files.length, 0) }
}

/** The place in the list of the cycle a file is part of, if any. */
export function cycleOfFile(list: CycleList, file: number): number | null {
  const at = list.cycles.findIndex((cycle) => cycle.members.includes(file))
  return at < 0 ? null : at
}

/** The two folders holding the most of these files, or the one holding them all. */
function mainFolders(context: TourContext, files: readonly number[]): string[] {
  const { dir } = context.index.result.files
  const counts = new Map<number, number>()
  for (const file of files) {
    const folder = dir[file] ?? 0
    counts.set(folder, (counts.get(folder) ?? 0) + 1)
  }
  return [...counts]
    .map(([folder, count]) => ({ name: folderName(context, folder), count }))
    .sort((a, b) => b.count - a.count || compare(a.name, b.name))
    .slice(0, 2)
    .map(({ name }) => name)
}

/** A folder's path from the name of its island: `editor/contrib/find` for `src/vs/editor/…`. */
export function folderName(context: TourContext, folder: number): string {
  const { index, islandNames } = context
  const path = index.folderPaths[folder] ?? '/'
  const island = index.result.dirs.island[folder] ?? -1
  const islandPath = index.folderPaths[index.result.islands.dir[island] ?? -1]
  const name = islandNames[island]
  if (islandPath === undefined || name === undefined) {
    return path
  }
  if (islandPath === '/') {
    return path === '/' ? name : `${name}/${path}`
  }
  return path.startsWith(islandPath) ? `${name}${path.slice(islandPath.length)}` : path
}

/** By code point: the same order on every machine. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
