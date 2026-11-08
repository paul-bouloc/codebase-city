import type {
  FileHit,
  FolderHit,
  SearchGroup,
  SearchResults,
  SymbolHit,
} from '../ui/city/search-data'
import { languageOf, type ResultIndex } from './result-index'
import { editDistance, fuzzyMatch, lowerCase, type Match } from './search-match'

// The city's search: file, folder and symbol names, matched in the browser on the result the city
// was built from. A query with a `/` matches whole paths instead, and no symbols.

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

/** A text the search matches, with its lower-case form worked out once. */
interface Target {
  text: string
  lower: string
}

const target = (text: string): Target => ({ text, lower: lowerCase(text) })

/** The query as the search reads it: without spaces. */
export function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, '')
}

/** What orders two hits: the score, then the shorter name, then the weightier, then the path. */
interface Rank {
  score: number
  length: number
  /** What a file weighs in the city: the files that depend on it (a folder: the files it holds). */
  weight: number
  key: string
}

/** Keeps the `limit` best of what it is given, the best first. */
class Best<Hit> {
  readonly hits: { hit: Hit; rank: Rank }[] = []
  total = 0

  constructor(private readonly limit: number) {}

  add(rank: Rank, make: () => Hit) {
    this.total++
    const { hits, limit } = this
    if (limit === 0) {
      return
    }
    const last = hits.at(-1)
    if (hits.length === limit && last && !before(rank, last.rank)) {
      return
    }
    let at = hits.length
    while (at > 0) {
      const previous = hits[at - 1]
      if (!previous || !before(rank, previous.rank)) {
        break
      }
      at--
    }
    hits.splice(at, 0, { hit: make(), rank })
    if (hits.length > limit) {
      hits.pop()
    }
  }

  group(): SearchGroup<Hit> {
    return { total: this.total, hits: this.hits.map(({ hit }) => hit) }
  }
}

function before(rank: Rank, other: Rank): boolean {
  if (rank.score !== other.score) {
    return rank.score > other.score
  }
  if (rank.length !== other.length) {
    return rank.length < other.length
  }
  if (rank.weight !== other.weight) {
    return rank.weight > other.weight
  }
  return rank.key < other.key
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

  // Outside production, a file weighs nothing: the code the project ships comes first.
  const weightOf = (file: number) => files.dependents[file] ?? 0

  // The strongest role the graph infers, else what the path says the file is.
  const roleOf = (file: number): Pick<FileHit, 'role' | 'inferred'> => {
    const graph = index.roles.get(file)?.[0]
    if (graph) {
      return { role: graph.role, inferred: true }
    }
    if (files.generated[file]) {
      return { role: 'generated', inferred: false }
    }
    const scope = files.scope[file]
    return { role: scope === 'test' || scope === 'config' ? scope : null, inferred: false }
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
      ...roleOf(file),
    }
  }

  const search = (raw: string, limits = SEARCH_LIMITS): SearchResults => {
    const query = normalizeQuery(raw)
    const lowerQuery = lowerCase(query)
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
      const rank = {
        score: found.score,
        length: text.text.length,
        weight: weightOf(file),
        key: path,
      }
      fileBest.add(rank, () =>
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
      const files = filesUnder[folder.dir] ?? 0
      const rank = { score: found.score, length: text.text.length, weight: files, key: folder.path }
      folderBest.add(rank, () => ({
        kind: 'folder',
        path: folder.path,
        nameStart: nameStartOf(folder.path),
        positions: found.positions.map((position) => position + offset),
        files,
      }))
    })

    if (!byPath) {
      symbolNames.forEach((text, row) => {
        const found = matchIn(text)
        if (!found) {
          return
        }
        const fileIndex = symbols.file[row] ?? 0
        const file = filePaths[fileIndex] ?? ''
        const line = symbols.line[row] ?? 1
        const rank = {
          score: found.score,
          length: text.text.length,
          weight: weightOf(fileIndex),
          key: `${file}:${line}`,
        }
        symbolBest.add(rank, () => ({
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

  // Every name once, without a file's extension, with how many carry it: worked out on the first
  // query that finds nothing.
  let names: { name: Target; count: number }[] | null = null
  const allNames = () => {
    if (!names) {
      const counts = new Map<string, number>()
      const add = (name: string) => {
        if (name) {
          counts.set(name, (counts.get(name) ?? 0) + 1)
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
      names = [...counts].map(([name, count]) => ({ name: target(name), count }))
    }
    return names
  }

  const suggest = (raw: string): string | null => {
    const query = lowerCase(normalizeQuery(raw))
    if (query.length < 3 || query.includes('/')) {
      return null
    }
    // The closest name; among names as close, the one most carry, the shortest, the first in order.
    let best: { text: string; distance: number; count: number } | null = null
    for (const { name, count } of allNames()) {
      const max = best?.distance ?? suggestionDistance(query.length)
      const distance = editDistance(query, name.lower, max)
      if (distance === 0 || distance > max) {
        continue
      }
      const better =
        !best ||
        distance < best.distance ||
        count > best.count ||
        (count === best.count &&
          (name.text.length < best.text.length ||
            (name.text.length === best.text.length && name.text < best.text)))
      if (better) {
        best = { text: name.text, distance, count }
      }
    }
    return best?.text ?? null
  }

  return { search, suggest }
}
