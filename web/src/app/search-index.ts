import type { SymbolKind } from '../data/generated/SymbolKind'
import type { FileRole, Language } from '../ui/Badge'
import { languageOf, type ResultIndex } from './result-index'
import { editDistance, fuzzyMatch, type Match } from './search-match'

// The city's search: file, folder and symbol names, matched in the browser on the result the city
// was built from. A query with a `/` matches whole paths instead, and no symbols.

/** A file found by the search. */
export interface FileHit {
  kind: 'file'
  path: string
  /** Where the name starts in the path. */
  nameStart: number
  /** The matched characters' indices in the path. */
  positions: number[]
  language: Language
  /** The language's own name, for one the interface has no colour for. */
  languageName: string
  /** The strongest role the graph gives it, else what the path says it is. */
  role: FileRole | null
}

/** A folder found by the search. */
export interface FolderHit {
  kind: 'folder'
  path: string
  nameStart: number
  positions: number[]
  /** Files in it, at any depth. */
  files: number
}

/** An exported symbol found by the search. */
export interface SymbolHit {
  kind: 'symbol'
  name: string
  /** The matched characters' indices in the name. */
  positions: number[]
  symbolKind: SymbolKind
  /** The file that exports it. */
  file: string
  line: number
}

export type SearchHit = FileHit | FolderHit | SymbolHit

export interface SearchGroup<Hit> {
  /** How many match in all. */
  total: number
  /** The best of them, the best first. */
  hits: Hit[]
}

export interface SearchResults {
  files: SearchGroup<FileHit>
  folders: SearchGroup<FolderHit>
  symbols: SearchGroup<SymbolHit>
}

export interface SearchLimits {
  files: number
  folders: number
  symbols: number
}

/** How many of each the palette shows: five files, three folders, three symbols. */
export const SEARCH_LIMITS: SearchLimits = { files: 5, folders: 3, symbols: 3 }

export interface SearchIndex {
  search(query: string, limits?: SearchLimits): SearchResults
  /** The name closest to a query that found nothing, if one is close enough. */
  suggest(query: string): string | null
}

const GRAPH_ROLES: ReadonlySet<string> = new Set([
  'entry-point',
  'conductor',
  'foundation',
  'facade',
])

/** A text the search matches, with its lower-case form worked out once. */
interface Target {
  text: string
  lower: string
}

const target = (text: string): Target => ({ text, lower: text.toLowerCase() })

/** The query as the search reads it: without spaces. */
export function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, '')
}

/** Keeps the `limit` best of what it is given, the best first: score, then shortest, then path. */
class Best<Hit> {
  readonly hits: { hit: Hit; score: number; length: number; key: string }[] = []
  total = 0

  constructor(private readonly limit: number) {}

  add(score: number, length: number, key: string, make: () => Hit) {
    this.total++
    const { hits, limit } = this
    if (limit === 0) {
      return
    }
    const last = hits.at(-1)
    if (hits.length === limit && last && !before(score, length, key, last)) {
      return
    }
    let at = hits.length
    while (at > 0) {
      const previous = hits[at - 1]
      if (!previous || !before(score, length, key, previous)) {
        break
      }
      at--
    }
    hits.splice(at, 0, { hit: make(), score, length, key })
    if (hits.length > limit) {
      hits.pop()
    }
  }

  group(): SearchGroup<Hit> {
    return { total: this.total, hits: this.hits.map(({ hit }) => hit) }
  }
}

function before(
  score: number,
  length: number,
  key: string,
  other: { score: number; length: number; key: string },
): boolean {
  if (score !== other.score) {
    return score > other.score
  }
  if (length !== other.length) {
    return length < other.length
  }
  return key < other.key
}

const nameStartOf = (path: string) => path.lastIndexOf('/') + 1

/** How far a suggestion may be from the query: one typo in a short word, more in a long one. */
function suggestionDistance(length: number): number {
  return length <= 4 ? 1 : length <= 8 ? 2 : 3
}

export function buildSearchIndex(index: ResultIndex): SearchIndex {
  const { result, filePaths, folderPaths } = index
  const { files, dirs, symbols } = result

  const fileNames = filePaths.map((path) => target(path.slice(nameStartOf(path))))
  const fullFilePaths = filePaths.map(target)

  // The root is the whole city: not a result.
  const folders = folderPaths.map((path, dir) => ({ path, dir })).filter(({ path }) => path !== '/')
  const folderNames = folders.map(({ path }) => target(path.slice(nameStartOf(path))))
  const fullFolderPaths = folders.map(({ path }) => target(path))
  const filesUnder = new Array<number>(folderPaths.length).fill(0)
  files.dir.forEach((dir) => {
    let at: number | null | undefined = dir
    while (at !== null && at !== undefined) {
      filesUnder[at] = (filesUnder[at] ?? 0) + 1
      at = dirs.parent[at]
    }
  })

  const symbolNames = symbols.name.map(target)

  const roleOf = (file: number): FileRole | null => {
    const graph = index.roles.get(file)?.find(({ role }) => GRAPH_ROLES.has(role))
    if (graph) {
      return graph.role
    }
    if (files.generated[file]) {
      return 'generated'
    }
    const scope = files.scope[file]
    return scope === 'test' || scope === 'config' ? scope : null
  }

  const fileHit = (file: number, positions: number[]): FileHit => {
    const path = filePaths[file] ?? ''
    const languageName = result.languages[files.language[file] ?? 0] ?? ''
    return {
      kind: 'file',
      path,
      nameStart: nameStartOf(path),
      positions,
      language: languageOf(languageName),
      languageName,
      role: roleOf(file),
    }
  }

  const search = (raw: string, limits = SEARCH_LIMITS): SearchResults => {
    const query = normalizeQuery(raw)
    const lowerQuery = query.toLowerCase()
    const byPath = query.includes('/')
    const fileBest = new Best<FileHit>(limits.files)
    const folderBest = new Best<FolderHit>(limits.folders)
    const symbolBest = new Best<SymbolHit>(limits.symbols)
    if (!query) {
      return { files: fileBest.group(), folders: folderBest.group(), symbols: symbolBest.group() }
    }

    const matchIn = (text: Target): Match | null =>
      fuzzyMatch(query, lowerQuery, text.text, text.lower)

    const fileTargets = byPath ? fullFilePaths : fileNames
    fileTargets.forEach((text, file) => {
      const found = matchIn(text)
      if (!found) {
        return
      }
      const path = filePaths[file] ?? ''
      const offset = byPath ? 0 : nameStartOf(path)
      fileBest.add(found.score, text.text.length, path, () =>
        fileHit(
          file,
          found.positions.map((position) => position + offset),
        ),
      )
    })

    const folderTargets = byPath ? fullFolderPaths : folderNames
    folderTargets.forEach((text, row) => {
      const found = matchIn(text)
      const folder = folders[row]
      if (!found || !folder) {
        return
      }
      const offset = byPath ? 0 : nameStartOf(folder.path)
      folderBest.add(found.score, text.text.length, folder.path, () => ({
        kind: 'folder',
        path: folder.path,
        nameStart: nameStartOf(folder.path),
        positions: found.positions.map((position) => position + offset),
        files: filesUnder[folder.dir] ?? 0,
      }))
    })

    if (!byPath) {
      symbolNames.forEach((text, row) => {
        const found = matchIn(text)
        if (!found) {
          return
        }
        const file = filePaths[symbols.file[row] ?? 0] ?? ''
        const line = symbols.line[row] ?? 1
        symbolBest.add(found.score, text.text.length, `${file}:${line}`, () => ({
          kind: 'symbol',
          name: text.text,
          positions: found.positions,
          symbolKind: symbols.kind[row] ?? 'function',
          file,
          line,
        }))
      })
    }

    return { files: fileBest.group(), folders: folderBest.group(), symbols: symbolBest.group() }
  }

  // Every name once, without a file's extension: worked out on the first query that finds nothing.
  let names: Target[] | null = null
  const allNames = (): Target[] => {
    if (!names) {
      const seen = new Set<string>()
      const list: Target[] = []
      const add = (name: string) => {
        if (name && !seen.has(name)) {
          seen.add(name)
          list.push(target(name))
        }
      }
      for (const { text } of fileNames) {
        const dot = text.lastIndexOf('.')
        add(dot > 0 ? text.slice(0, dot) : text)
      }
      for (const { text } of folderNames) {
        add(text)
      }
      for (const { text } of symbolNames) {
        add(text)
      }
      names = list
    }
    return names
  }

  const suggest = (raw: string): string | null => {
    const query = normalizeQuery(raw).toLowerCase()
    if (query.length < 3 || query.includes('/')) {
      return null
    }
    // The closest name; among names as close, the shortest, then the first in order.
    let best: { text: string; distance: number } | null = null
    for (const name of allNames()) {
      const max = best?.distance ?? suggestionDistance(query.length)
      const distance = editDistance(query, name.lower, max)
      if (distance === 0 || distance > max) {
        continue
      }
      const better =
        !best ||
        distance < best.distance ||
        name.text.length < best.text.length ||
        (name.text.length === best.text.length && name.text < best.text)
      if (better) {
        best = { text: name.text, distance }
      }
    }
    return best?.text ?? null
  }

  return { search, suggest }
}
