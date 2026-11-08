import { ANALYZED_LANGUAGES } from '../city/world/from-result'
import type { Language } from '../ui/Badge'
import { githubTreeUrl } from '../ui/city/github-links'
import type { FolderSheetData, IslandLink, KeyFile } from '../ui/city/sheet-data'
import { languageOf, type ResultIndex } from './result-index'

// A folder's sheet, read from the analysis result: an island's, or a parcel's on its island.

/** Up to 5 key files: likely roles first, then the most imported and the most complex (A13). */
const KEY_FILES = 5

/** The files a folder's sheet speaks of: an island's own, or all those under a parcel. */
function membersOf(index: ResultIndex, dir: number): number[] {
  const { files } = index.result
  const island = index.islandOfDir.get(dir)
  if (island !== undefined) {
    // A folder split into islands holds others: only its own files make its island.
    return files.dir.flatMap((at, file) => (index.result.dirs.island[at] === island ? [file] : []))
  }
  const under = new Set<number>([dir])
  const stack = [dir]
  for (let at = stack.pop(); at !== undefined; at = stack.pop()) {
    for (const child of index.children[at] ?? []) {
      under.add(child)
      stack.push(child)
    }
  }
  return files.dir.flatMap((at, file) => (under.has(at) ? [file] : []))
}

function keyFiles(index: ResultIndex, members: readonly number[]): KeyFile[] {
  const { files } = index.result
  const keys: KeyFile[] = []
  const taken = new Set<number>()
  const take = (file: number, reason: KeyFile['reason']) => {
    if (keys.length < KEY_FILES && !taken.has(file)) {
      taken.add(file)
      keys.push({ path: index.filePaths[file] ?? '', reason })
    }
  }
  const inside = new Set(members)
  // The roles in the order the analysis ranks them, the strongest role of each file.
  const roleOrder = ['entry-point', 'conductor', 'foundation'] as const
  for (const role of roleOrder) {
    for (const [file, roles] of index.roles) {
      if (inside.has(file) && roles[0]?.role === role) {
        take(file, { role })
      }
    }
  }
  // Generated files and facades are left out of the rankings.
  const rankable = members.filter((file) => !files.generated[file] && !files.barrel[file])
  const mostImported = maxBy(rankable, (file) => index.importers[file]?.length ?? 0)
  if (mostImported !== undefined) {
    take(mostImported.item, { mostImported: mostImported.value })
  }
  const mostComplex = maxBy(rankable, (file) => files.complexity[file] ?? 0)
  if (mostComplex !== undefined) {
    take(mostComplex.item, { mostComplex: mostComplex.value })
  }
  return keys
}

/** The item with the largest positive value, the first on a tie. */
function maxBy<T>(
  items: readonly T[],
  value: (item: T) => number,
): { item: T; value: number } | undefined {
  let best: { item: T; value: number } | undefined
  for (const item of items) {
    const each = value(item)
    if (each > 0 && (!best || each > best.value)) {
      best = { item, value: each }
    }
  }
  return best
}

/**
 * Imports between the folder's files and other islands' files, both ways, the largest first. An
 * import into a higher layer goes up the layers: it is listed apart, in red, but a facade's
 * re-exports never count as one (it offers what it re-exports, it does not depend on it).
 */
function islandLinks(
  index: ResultIndex,
  members: readonly number[],
  home: number | null,
): IslandLink[] {
  const { result } = index
  const inside = new Set(members)
  // A Go import names a package: its folder.
  const insideDirs = new Set(members.map((file) => result.files.dir[file] ?? -1))
  const out = new Map<number, { count: number; upward: number }>()
  const into = new Map<number, number>()
  const layerOf = (island: number) => result.islands.layer[island] ?? null
  const homeLayer = home === null ? null : layerOf(home)

  // Each edge once, a Go package's files as one target: as the analysis counts links.
  const { edges, files } = result
  edges.from.forEach((from, row) => {
    const to = edges.to[row]
    const toDir = edges.toDir[row]
    const toIsland =
      to !== null && to !== undefined
        ? index.islandOfFile(to)
        : toDir !== null && toDir !== undefined
          ? (result.dirs.island[toDir] ?? null)
          : null
    const fromIsland = index.islandOfFile(from)
    if (toIsland === null || fromIsland === null || toIsland === fromIsland) {
      return
    }
    const intoFolder =
      to !== null && to !== undefined
        ? inside.has(to)
        : toDir !== null && toDir !== undefined && insideDirs.has(toDir)
    // Between two islands of a folder that holds them: not a link with another island.
    if (inside.has(from) && intoFolder) {
      return
    }
    if (inside.has(from)) {
      const toLayer = layerOf(toIsland)
      const reexport = files.barrel[from] && edges.kind[row] === 'reexport'
      const upward = !reexport && homeLayer !== null && toLayer !== null && toLayer > homeLayer
      const link = out.get(toIsland) ?? { count: 0, upward: 0 }
      link.count++
      if (upward) {
        link.upward++
      }
      out.set(toIsland, link)
    } else if (intoFolder) {
      into.set(fromIsland, (into.get(fromIsland) ?? 0) + 1)
    }
  })

  const named = (island: number) => {
    const dir = result.islands.dir[island] ?? 0
    return { island: result.dirs.name[dir] || '/', islandPath: index.folderPaths[dir] ?? '/' }
  }
  const links: IslandLink[] = []
  for (const [island, { count, upward }] of out) {
    if (count > upward) {
      links.push({ ...named(island), direction: 'imports', upward: false, count: count - upward })
    }
    if (upward > 0) {
      links.push({ ...named(island), direction: 'imports', upward: true, count: upward })
    }
  }
  for (const [island, count] of into) {
    links.push({ ...named(island), direction: 'importedBy', upward: false, count })
  }
  const order = (link: IslandLink) => (link.upward ? 2 : link.direction === 'imports' ? 0 : 1)
  return links.sort(
    (a, b) => order(a) - order(b) || b.count - a.count || a.island.localeCompare(b.island),
  )
}

export function folderSheetData(index: ResultIndex, path: string): FolderSheetData | undefined {
  const dir = index.folderAt(path)
  if (dir === undefined) {
    return undefined
  }
  const { result } = index
  const { files } = result
  const members = membersOf(index, dir)
  const ownIsland = index.islandOfDir.get(dir)
  const island = ownIsland ?? result.dirs.island[dir] ?? null
  const layer = island === null ? null : (result.islands.layer[island] ?? null)
  const parcelRow = result.layout.parcels.dir.indexOf(dir)
  const islandDir = island === null ? undefined : result.islands.dir[island]

  // A park when most of its files are tests: the parcel's nature, or an island's own files.
  const tests =
    parcelRow >= 0
      ? result.layout.parcels.nature[parcelRow] === 'tests'
      : ownIsland !== undefined &&
        members.filter((file) => files.scope[file] === 'test').length * 2 > members.length
  const islandName = islandDir === undefined ? '/' : result.dirs.name[islandDir] || '/'
  const kind: FolderSheetData['kind'] = tests
    ? 'tests'
    : island === null
      ? 'folder'
      : ownIsland === undefined
        ? { parcel: { island: islandName } }
        : layer === null
          ? 'island'
          : { island: { layer, of: index.layers } }

  const byLanguage = new Map<Language, number>()
  let lines = 0
  let analyzed = false
  for (const file of members) {
    const name = result.languages[files.language[file] ?? 0] ?? ''
    const language = languageOf(name)
    byLanguage.set(language, (byLanguage.get(language) ?? 0) + 1)
    lines += files.lines[file] ?? 0
    analyzed ||= ANALYZED_LANGUAGES.has(name)
  }
  const languages = [...byLanguage]
    .map(([language, count]) => ({ language, share: count / Math.max(members.length, 1) }))
    // The shared colour last, whatever its share.
    .sort(
      (a, b) =>
        Number(a.language === 'other') - Number(b.language === 'other') || b.share - a.share,
    )

  // An island's sub-folders on it: one that is an island of its own stands apart. A folder that
  // holds islands counts them all.
  const subFolders = (index.children[dir] ?? []).filter(
    (child) => island === null || !index.islandOfDir.has(child),
  ).length

  return {
    path,
    kind,
    analyzed,
    files: members.length,
    lines,
    subFolders,
    languages,
    keyFiles: analyzed ? keyFiles(index, members) : [],
    links: analyzed ? islandLinks(index, members, island) : [],
    githubUrl: githubTreeUrl(result.repo, result.sha, path === '/' ? '' : path),
  }
}
