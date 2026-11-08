import type { AnalysisResult } from '../../data/generated/AnalysisResult'
import type { FileRole, Language } from '../../ui/Badge'
import { folderPaths } from '../world/from-result'

// What the hover cards of the city say, read from an analysis result once per city.

/** A file's card. */
export interface FileCard {
  path: string
  language: Language
  /** The language's own name, which may be one the analyzer does not read ("JSON"). */
  languageName: string
  lines: number
  /** Absent for a file the analysis does not read. */
  complexity?: number
  /** Its complexity's place, in percent of the repository: 1 for the top 1 %; absent past 10. */
  complexityTop?: number
  /** Files that import it, and files it imports, directly. */
  incoming: number
  outgoing: number
  fileRole?: FileRole
}

/** A folder's card: an island's, or a parcel's on its island. */
export interface FolderCard {
  path: string
  /** Every file under it. */
  files: number
  /** Its island's layer; absent for an island without production code. */
  layer?: number
  /** The island it stands on, by name; absent for an island's own folder. */
  island?: string
}

export interface CityCards {
  file(path: string): FileCard | undefined
  folder(path: string): FolderCard | undefined
}

/** Only the most complex files say where they rank. */
const SHOWN_TOP = 10

const LANGUAGES: Record<string, Language> = {
  TypeScript: 'typescript',
  JavaScript: 'javascript',
  Python: 'python',
  Go: 'go',
  CSS: 'css',
}

export function cityCards(result: AnalysisResult): CityCards {
  const { dirs, files, edges, roles } = result
  const folders = folderPaths(dirs)
  const filePaths = files.dir.map((dir, file) => {
    const folder = folders[dir] ?? '/'
    const name = files.name[file] ?? ''
    return folder === '/' ? name : `${folder}/${name}`
  })
  const fileIndex = new Map(filePaths.map((path, file) => [path, file]))

  const incoming = new Array<number>(filePaths.length).fill(0)
  const outgoing = new Array<number>(filePaths.length).fill(0)
  // A Go import names a package: each of its files is imported by the importer.
  const filesIn = new Map<number, number[]>()
  files.dir.forEach((dir, file) => {
    const members = filesIn.get(dir)
    if (members) {
      members.push(file)
    } else {
      filesIn.set(dir, [file])
    }
  })
  edges.from.forEach((from, row) => {
    outgoing[from] = (outgoing[from] ?? 0) + 1
    const to = edges.to[row]
    const toDir = edges.toDir[row]
    const targets =
      to !== null && to !== undefined
        ? [to]
        : toDir !== null && toDir !== undefined
          ? (filesIn.get(toDir) ?? [])
          : []
    for (const target of targets) {
      incoming[target] = (incoming[target] ?? 0) + 1
    }
  })

  // The strongest role first: what starts the code, what pulls it together, what it rests on.
  const role = new Map<number, FileRole>()
  const give = (list: readonly (number | null)[], fileRole: FileRole) => {
    for (const file of list) {
      if (file !== null && !role.has(file)) {
        role.set(file, fileRole)
      }
    }
  }
  give(roles.entries.file, 'entry-point')
  give(roles.conductors.file, 'conductor')
  give(roles.foundations.file, 'foundation')
  give(
    files.barrel.map((barrel, file) => (barrel ? file : null)),
    'facade',
  )

  // Generated files are left out of every ranking.
  const ranked = files.complexity
    .map((complexity, file) => ({ complexity, file }))
    .filter(
      (row): row is { complexity: number; file: number } =>
        row.complexity !== null && !files.generated[row.file],
    )
    .sort((a, b) => b.complexity - a.complexity)
  const top = new Map<number, number>()
  ranked.forEach(({ file }, rank) => {
    const percent = Math.max(1, Math.ceil(((rank + 1) / ranked.length) * 100))
    if (percent <= SHOWN_TOP) {
      top.set(file, percent)
    }
  })

  // Files under each folder, counted up its ancestors.
  const under = new Array<number>(dirs.parent.length).fill(0)
  for (const dir of files.dir) {
    for (let at: number | null | undefined = dir; at !== null && at !== undefined; ) {
      under[at] = (under[at] ?? 0) + 1
      at = dirs.parent[at]
    }
  }
  // An island holds its own folder's files only when that folder is split into islands.
  const onIsland = new Array<number>(result.islands.dir.length).fill(0)
  for (const dir of files.dir) {
    const island = dirs.island[dir]
    if (island !== null && island !== undefined) {
      onIsland[island] = (onIsland[island] ?? 0) + 1
    }
  }
  const folderIndex = new Map(folders.map((path, dir) => [path, dir]))
  const islandOf = new Map(result.islands.dir.map((dir, island) => [dir, island]))

  return {
    file(path) {
      const file = fileIndex.get(path)
      if (file === undefined) {
        return undefined
      }
      const languageName = result.languages[files.language[file] ?? 0] ?? ''
      const complexity = files.complexity[file]
      const fileRole = role.get(file)
      const complexityTop = top.get(file)
      return {
        path,
        language: LANGUAGES[languageName] ?? 'other',
        languageName,
        lines: files.lines[file] ?? 0,
        ...(complexity !== null && complexity !== undefined ? { complexity } : {}),
        ...(complexityTop !== undefined ? { complexityTop } : {}),
        incoming: incoming[file] ?? 0,
        outgoing: outgoing[file] ?? 0,
        ...(fileRole ? { fileRole } : {}),
      }
    },
    folder(path) {
      const dir = folderIndex.get(path)
      if (dir === undefined) {
        return undefined
      }
      const ownIsland = islandOf.get(dir)
      const island = ownIsland ?? dirs.island[dir]
      const layer = island === null || island === undefined ? null : result.islands.layer[island]
      const islandDir =
        island === null || island === undefined ? undefined : result.islands.dir[island]
      const islandName = islandDir === undefined ? undefined : dirs.name[islandDir] || '/'
      return {
        path,
        files: (ownIsland === undefined ? under[dir] : onIsland[ownIsland]) ?? 0,
        ...(layer !== null && layer !== undefined ? { layer } : {}),
        ...(ownIsland === undefined && islandName !== undefined ? { island: islandName } : {}),
      }
    },
  }
}
