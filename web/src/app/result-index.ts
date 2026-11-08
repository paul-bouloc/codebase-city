import { folderPaths } from '../city/world/from-result'
import type { AnalysisResult } from '../data/generated/AnalysisResult'
import type { EntryReason } from '../data/generated/EntryReason'
import type { Language } from '../ui/Badge'

// What the city screen reads from an analysis result again and again, worked out once per city:
// paths both ways, the direct imports of each file both ways, roles and complexity ranks.

const LANGUAGES: Record<string, Language> = {
  TypeScript: 'typescript',
  JavaScript: 'javascript',
  Python: 'python',
  Go: 'go',
  CSS: 'css',
}

/** The language the interface paints a language name in: its own colour, or the shared one. */
export function languageOf(name: string): Language {
  return LANGUAGES[name] ?? 'other'
}

/** A role the graph gives a file, with what grounds it. */
export type GraphRole =
  | { role: 'entry-point'; reasons: readonly EntryReason[]; command: string | null }
  | { role: 'conductor'; dependencies: number }
  | { role: 'foundation'; dependents: number }
  | { role: 'facade' }

export interface ResultIndex {
  result: AnalysisResult
  /** Every file's path from the repository root, by file. */
  filePaths: readonly string[]
  /** Every folder's path, `/` for the root, by folder. */
  folderPaths: readonly string[]
  fileAt(path: string): number | undefined
  folderAt(path: string): number | undefined
  /** The island each folder is, if it is one. */
  islandOfDir: ReadonlyMap<number, number>
  /** The island a file stands on; null for a file on none. */
  islandOfFile(file: number): number | null
  /** The files each file imports directly; a Go package's import counts each of its files. */
  imports: readonly (readonly number[])[]
  /** The files that import each file directly. */
  importers: readonly (readonly number[])[]
  /** Each file's roles, the strongest first. */
  roles: ReadonlyMap<number, readonly GraphRole[]>
  /** Each ranked file's place by complexity, from 1; generated files are left out. */
  complexityRank: ReadonlyMap<number, number>
  /** How many files the complexity ranking holds. */
  rankedFiles: number
  /** The folders right under each folder. */
  children: readonly (readonly number[])[]
  /** The highest layer of the city; 0 when no island has production code. */
  layers: number
}

export function indexResult(result: AnalysisResult): ResultIndex {
  const { dirs, files, edges, roles } = result
  const folders = folderPaths(dirs)
  const filePaths = files.dir.map((dir, file) => {
    const folder = folders[dir] ?? '/'
    const name = files.name[file] ?? ''
    return folder === '/' ? name : `${folder}/${name}`
  })
  const fileByPath = new Map(filePaths.map((path, file) => [path, file]))
  const folderByPath = new Map(folders.map((path, dir) => [path, dir]))
  const islandOfDir = new Map(result.islands.dir.map((dir, island) => [dir, island]))

  const children: number[][] = dirs.parent.map(() => [])
  dirs.parent.forEach((parent, dir) => {
    if (parent !== null) {
      children[parent]?.push(dir)
    }
  })

  // A Go import names a package: each of its own files is imported.
  const filesIn: number[][] = dirs.parent.map(() => [])
  files.dir.forEach((dir, file) => {
    filesIn[dir]?.push(file)
  })
  const imports = new Array<Set<number>>(filePaths.length)
  const importers = new Array<Set<number>>(filePaths.length)
  for (let file = 0; file < filePaths.length; file++) {
    imports[file] = new Set()
    importers[file] = new Set()
  }
  edges.from.forEach((from, row) => {
    const to = edges.to[row]
    const toDir = edges.toDir[row]
    const targets =
      to !== null && to !== undefined
        ? [to]
        : toDir !== null && toDir !== undefined
          ? (filesIn[toDir] ?? [])
          : []
    for (const target of targets) {
      if (target !== from) {
        imports[from]?.add(target)
        importers[target]?.add(from)
      }
    }
  })

  // What starts the code, what pulls it together, what it rests on, what gathers it.
  const fileRoles = new Map<number, GraphRole[]>()
  const give = (file: number | null | undefined, role: GraphRole) => {
    if (file === null || file === undefined) {
      return
    }
    const list = fileRoles.get(file)
    if (!list) {
      fileRoles.set(file, [role])
    } else if (!list.some((each) => each.role === role.role)) {
      list.push(role)
    }
  }
  roles.entries.file.forEach((file, row) => {
    give(file, {
      role: 'entry-point',
      reasons: roles.entries.reasons[row] ?? [],
      command: roles.entries.command[row] ?? null,
    })
  })
  roles.conductors.file.forEach((file, row) => {
    give(file, { role: 'conductor', dependencies: roles.conductors.count[row] ?? 0 })
  })
  roles.foundations.file.forEach((file, row) => {
    give(file, { role: 'foundation', dependents: roles.foundations.count[row] ?? 0 })
  })
  files.barrel.forEach((barrel, file) => {
    if (barrel) {
      give(file, { role: 'facade' })
    }
  })

  // Generated files are left out of every ranking.
  const ranked = files.complexity
    .map((complexity, file) => ({ complexity, file }))
    .filter(
      (row): row is { complexity: number; file: number } =>
        row.complexity !== null && !files.generated[row.file],
    )
    .sort((a, b) => b.complexity - a.complexity || a.file - b.file)
  const complexityRank = new Map(ranked.map(({ file }, rank) => [file, rank + 1]))

  const layers = result.islands.layer.reduce<number>((high, layer) => Math.max(high, layer ?? 0), 0)

  return {
    result,
    filePaths,
    folderPaths: folders,
    fileAt: (path) => fileByPath.get(path),
    folderAt: (path) => folderByPath.get(path),
    islandOfDir,
    islandOfFile: (file) => dirs.island[files.dir[file] ?? 0] ?? null,
    imports: imports.map((set) => [...set]),
    importers: importers.map((set) => [...set]),
    roles: fileRoles,
    complexityRank,
    rankedFiles: ranked.length,
    children,
    layers,
  }
}

/** The share of the ranking at or above a rank, in whole percent: 1 for the top 1 %. */
export function topPercent(rank: number, of: number): number {
  return Math.max(1, Math.ceil((rank / of) * 100))
}
