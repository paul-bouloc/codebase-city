import { SINGLE_ARCS } from '../city/flows/selection-links'
import { ANALYZED_LANGUAGES } from '../city/world/from-result'
import type { EntryReason } from '../data/generated/EntryReason'
import { githubBlobUrl } from '../ui/city/github-links'
import type {
  CodeState,
  FileSheetData,
  FileSymbol,
  InferredRole,
  RankedFile,
} from '../ui/city/sheet-data'
import { exactCount } from '../ui/count-format'
import { type GraphRole, languageOf, type ResultIndex, topPercent } from './result-index'

// A file's sheet, read from the analysis result. Its code comes from GitHub, apart.

const ENTRY_REASONS: Record<EntryReason, string> = {
  packageBin: 'package.json names it as a command.',
  packageMain: 'package.json names it as the package’s main file.',
  packageScript: 'A script of package.json runs it.',
  pyprojectScript: 'pyproject.toml names it as a command.',
  setupCfgScript: 'setup.cfg names it as a command.',
  goMain: 'It is the main package of a Go program.',
  mainModule: 'Python runs it as a package’s __main__ module.',
  mainBlock: 'It runs code when started directly (if __name__ == "__main__").',
  framework: 'Its framework starts it, by convention.',
  conventionalName: 'Its name is the one projects give their starting file.',
  noImporter: 'Nothing in the project imports it.',
}

/** The sentence under a role: the measure that grounds it (P9). */
function roleReason(role: GraphRole, dependencies: number | null): string {
  switch (role.role) {
    case 'entry-point': {
      const why = ENTRY_REASONS[role.reasons[0] ?? 'noImporter']
      return dependencies
        ? `${why} It depends on ${exactCount(dependencies)} ${files(dependencies)}, directly or not.`
        : why
    }
    case 'conductor':
      return `Depends on ${exactCount(role.dependencies)} ${files(role.dependencies)}, directly or not, while few depend on it.`
    case 'foundation':
      return `${exactCount(role.dependents)} ${files(role.dependents)} depend on it, directly or not.`
    case 'facade':
      return 'Made of re-exports: it gathers what other files define.'
  }
}

const files = (count: number) => (count === 1 ? 'file' : 'files')

/** The symbol kinds the sheet groups; every kind the analyzer reports. */
const SYMBOL_KINDS: ReadonlySet<string> = new Set([
  'class',
  'function',
  'interface',
  'type',
  'enum',
  'constant',
])

/** Each file's exported symbols, in file order: the table is sorted by file, then by line. */
export function symbolsByFile(index: ResultIndex): ReadonlyMap<number, FileSymbol[]> {
  const { symbols } = index.result
  const byFile = new Map<number, FileSymbol[]>()
  symbols.file.forEach((file, row) => {
    const kind = symbols.kind[row]
    if (kind === undefined || !SYMBOL_KINDS.has(kind)) {
      return
    }
    const symbol: FileSymbol = {
      name: symbols.name[row] ?? '',
      kind,
      line: symbols.line[row] ?? 1,
    }
    const list = byFile.get(file)
    if (list) {
      list.push(symbol)
    } else {
      byFile.set(file, [symbol])
    }
  })
  return byFile
}

export function fileSheetData(
  index: ResultIndex,
  symbols: ReadonlyMap<number, FileSymbol[]>,
  path: string,
  code: CodeState,
): FileSheetData | undefined {
  const file = index.fileAt(path)
  if (file === undefined) {
    return undefined
  }
  const { result } = index
  const { files: table } = result
  const languageName = result.languages[table.language[file] ?? 0] ?? ''
  const analyzed = ANALYZED_LANGUAGES.has(languageName)
  const complexity = table.complexity[file]
  const rank = index.complexityRank.get(file)
  const dependencies = table.dependencies[file] ?? null
  const importers = index.importers[file] ?? []
  const imports = index.imports[file] ?? []
  const ranked = (list: readonly number[]): RankedFile[] =>
    list.map((other) => ({
      path: index.filePaths[other] ?? '',
      importers: index.importers[other]?.length ?? 0,
    }))

  const island = index.islandOfFile(file)
  const islandDir = island === null ? undefined : result.islands.dir[island]
  const layer = island === null ? null : (result.islands.layer[island] ?? null)
  const cycle = result.cycles.members.find((members) => members.includes(file))

  const roles: InferredRole[] = (index.roles.get(file) ?? []).map((role) => ({
    role: role.role,
    reason: roleReason(role, dependencies),
  }))

  return {
    path,
    languageName,
    language: languageOf(languageName),
    analyzed,
    lines: table.lines[file] ?? 0,
    ...(complexity !== null && complexity !== undefined ? { complexity } : {}),
    ...(rank !== undefined
      ? {
          complexityTop: topPercent(rank, index.rankedFiles),
          complexityRank: rank,
          repoFiles: index.rankedFiles,
        }
      : {}),
    roles,
    importers: importers.length,
    dependents: table.dependents[file] ?? importers.length,
    // The city draws the nearest importers' arcs one by one, and groups the rest by island.
    ...(importers.length > SINGLE_ARCS ? { shownImporters: SINGLE_ARCS } : {}),
    imports: imports.length,
    ...(layer !== null && islandDir !== undefined
      ? {
          layer: {
            index: layer,
            of: index.layers,
            island: result.dirs.name[islandDir] || '/',
            islandPath: index.folderPaths[islandDir] ?? '/',
          },
        }
      : {}),
    cycles: cycle ? [cycle.length] : [],
    ...(table.header[file] ? { headerComment: table.header[file] ?? '' } : {}),
    importList: ranked(imports),
    importerList: ranked(importers),
    symbols: symbols.get(file) ?? [],
    code,
    githubUrl: githubBlobUrl(result.repo, result.sha, path),
  }
}
