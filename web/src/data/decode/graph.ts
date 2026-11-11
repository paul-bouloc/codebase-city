import type { Cycles } from '../generated/Cycles'
import type { Dirs } from '../generated/Dirs'
import type { Edges } from '../generated/Edges'
import type { Entries } from '../generated/Entries'
import type { Islands } from '../generated/Islands'
import type { Links } from '../generated/Links'
import type { Ranked } from '../generated/Ranked'
import type { Roles } from '../generated/Roles'
import {
  column,
  fail,
  inBounds,
  inBoundsOrNull,
  isConfidence,
  isEdgeKind,
  isEntryReasons,
  isStringOrNull,
  isU32List,
  isU32OrNull,
  object,
  sameLength,
  u32Column,
} from './checks'

export function decodeEdges(value: unknown, fileCount: number, dirCount: number): Edges {
  const fields = object(value, 'edges')
  const from = u32Column(fields.from, 'edges.from')
  const edges: Edges = {
    from,
    to: column(fields.to, 'edges.to', isU32OrNull, 'an index or null'),
    toDir: column(fields.toDir, 'edges.toDir', isU32OrNull, 'an index or null'),
    kind: column(fields.kind, 'edges.kind', isEdgeKind, 'an edge kind'),
    confidence: column(fields.confidence, 'edges.confidence', isConfidence, 'a confidence'),
  }
  sameLength('edges.to', from.length, edges.to)
  sameLength('edges.toDir', from.length, edges.toDir)
  sameLength('edges.kind', from.length, edges.kind)
  sameLength('edges.confidence', from.length, edges.confidence)
  inBounds('edges.from', from, fileCount)
  inBoundsOrNull('edges.to', edges.to, fileCount)
  inBoundsOrNull('edges.toDir', edges.toDir, dirCount)
  // Sort key of the previous edge: importing file, folder target (1) after file target (0), index
  let previous: [number, number, number] | null = null
  for (let row = 0; row < from.length; row++) {
    const source = from[row] as number
    const file = edges.to[row] ?? null
    const dir = edges.toDir[row] ?? null
    if ((file === null) === (dir === null)) {
      fail(`edges[${row}] must have exactly one target, in to or toDir`)
    }
    if (file === source) {
      fail(`edges[${row}] points to the file it comes from`)
    }
    const key: [number, number, number] =
      file === null ? [source, 1, dir as number] : [source, 0, file]
    // Strictly increasing, so a target appears once per file
    if (previous !== null && compareKeys(previous, key) >= 0) {
      fail(`edges[${row}] must come after the previous edge, by file then target`)
    }
    previous = key
  }
  return edges
}

function compareKeys(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

/** Rows of a role table that each point to one file or one folder, in bounds. */
function targets(
  path: string,
  file: (number | null)[],
  dir: (number | null)[],
  fileCount: number,
  dirCount: number,
): void {
  sameLength(`${path}.dir`, file.length, dir)
  inBoundsOrNull(`${path}.file`, file, fileCount)
  inBoundsOrNull(`${path}.dir`, dir, dirCount)
  const row = file.findIndex((index, row) => (index === null) === (dir[row] === null))
  if (row !== -1) {
    fail(`${path}[${row}] must have exactly one target, in file or dir`)
  }
}

function decodeEntries(value: unknown, fileCount: number, dirCount: number): Entries {
  const fields = object(value, 'roles.entries')
  const entries: Entries = {
    file: column(fields.file, 'roles.entries.file', isU32OrNull, 'an index or null'),
    dir: column(fields.dir, 'roles.entries.dir', isU32OrNull, 'an index or null'),
    reasons: column(fields.reasons, 'roles.entries.reasons', isEntryReasons, 'a list of reasons'),
    command: column(fields.command, 'roles.entries.command', isStringOrNull, 'a string or null'),
  }
  sameLength('roles.entries.reasons', entries.file.length, entries.reasons)
  sameLength('roles.entries.command', entries.file.length, entries.command)
  targets('roles.entries', entries.file, entries.dir, fileCount, dirCount)
  const empty = entries.reasons.findIndex((reasons) => reasons.length === 0)
  if (empty !== -1) {
    fail(`roles.entries.reasons[${empty}] is empty`)
  }
  return entries
}

function decodeRanked(value: unknown, path: string, fileCount: number, dirCount: number): Ranked {
  const fields = object(value, path)
  const ranked: Ranked = {
    file: column(fields.file, `${path}.file`, isU32OrNull, 'an index or null'),
    dir: column(fields.dir, `${path}.dir`, isU32OrNull, 'an index or null'),
    count: u32Column(fields.count, `${path}.count`),
  }
  targets(path, ranked.file, ranked.dir, fileCount, dirCount)
  sameLength(`${path}.count`, ranked.file.length, ranked.count)
  return ranked
}

export function decodeRoles(value: unknown, fileCount: number, dirCount: number): Roles {
  const fields = object(value, 'roles')
  return {
    entries: decodeEntries(fields.entries, fileCount, dirCount),
    foundations: decodeRanked(fields.foundations, 'roles.foundations', fileCount, dirCount),
    conductors: decodeRanked(fields.conductors, 'roles.conductors', fileCount, dirCount),
  }
}

// Islands are connected parts of the folder tree, each starting at the folder it is named after.
export function decodeIslands(value: unknown, dirs: Dirs): Islands {
  const fields = object(value, 'islands')
  const islands: Islands = {
    dir: u32Column(fields.dir, 'islands.dir'),
    layer: column(fields.layer, 'islands.layer', isU32OrNull, 'an index or null'),
  }
  const count = islands.dir.length
  sameLength('islands.layer', count, islands.layer)
  inBounds('islands.dir', islands.dir, dirs.parent.length)
  inBoundsOrNull('dirs.island', dirs.island, count)
  for (let row = 1; row < count; row++) {
    if ((islands.dir[row - 1] as number) >= (islands.dir[row] as number)) {
      fail(`islands[${row}] must come after the previous island, by folder`)
    }
  }
  islands.dir.forEach((dir, row) => {
    if (dirs.island[dir] !== row) {
      fail(`dirs.island of islands.dir[${row}] must point back to island ${row}`)
    }
  })
  for (let row = 1; row < dirs.island.length; row++) {
    const island = dirs.island[row]
    if (island === null || island === undefined || islands.dir[island] === row) {
      continue
    }
    if (dirs.island[dirs.parent[row] as number] !== island) {
      fail(`dirs.island[${row}] must be its parent's island, or an island named after it`)
    }
  }
  const layerZero = islands.layer.indexOf(0)
  if (layerZero !== -1) {
    fail(`islands.layer[${layerZero}] must be 1 or more`)
  }
  return islands
}

export function decodeLinks(value: unknown, layers: (number | null)[]): Links {
  const islandCount = layers.length
  const fields = object(value, 'links')
  const links: Links = {
    from: u32Column(fields.from, 'links.from'),
    to: u32Column(fields.to, 'links.to'),
    imports: u32Column(fields.imports, 'links.imports'),
    upward: u32Column(fields.upward, 'links.upward'),
    production: u32Column(fields.production, 'links.production'),
    productionUpward: u32Column(fields.productionUpward, 'links.productionUpward'),
  }
  sameLength('links.to', links.from.length, links.to)
  sameLength('links.imports', links.from.length, links.imports)
  sameLength('links.upward', links.from.length, links.upward)
  sameLength('links.production', links.from.length, links.production)
  sameLength('links.productionUpward', links.from.length, links.productionUpward)
  inBounds('links.from', links.from, islandCount)
  inBounds('links.to', links.to, islandCount)
  for (let row = 0; row < links.from.length; row++) {
    const from = links.from[row] as number
    const to = links.to[row] as number
    if (from === to) {
      fail(`links[${row}] goes from an island to itself`)
    }
    if (row > 0) {
      const previousFrom = links.from[row - 1] as number
      const previousTo = links.to[row - 1] as number
      if (previousFrom > from || (previousFrom === from && previousTo >= to)) {
        fail(`links[${row}] must come after the previous link, by islands`)
      }
    }
    if (links.imports[row] === 0) {
      fail(`links.imports[${row}] must be 1 or more`)
    }
    const upward = links.upward[row] as number
    const fromLayer = layers[from] ?? null
    const toLayer = layers[to] ?? null
    const goesUp = fromLayer !== null && toLayer !== null && toLayer > fromLayer
    if (upward > (links.imports[row] as number) || (upward > 0 && !goesUp)) {
      fail(`links.upward[${row}] must be at most links.imports, between layers that go up`)
    }
    const production = links.production[row] as number
    const productionUpward = links.productionUpward[row] as number
    if (
      production > (links.imports[row] as number) ||
      productionUpward > production ||
      productionUpward > upward
    ) {
      fail(
        `links.production[${row}] must be at most links.imports, and links.productionUpward at most links.production and links.upward`,
      )
    }
  }
  return links
}

export function decodeCycles(value: unknown, fileCount: number): Cycles {
  const fields = object(value, 'cycles')
  const cycles: Cycles = {
    members: column(fields.members, 'cycles.members', isU32List, 'a list of indexes'),
    shortest: column(fields.shortest, 'cycles.shortest', isU32List, 'a list of indexes'),
  }
  sameLength('cycles.shortest', cycles.members.length, cycles.shortest)
  cycles.members.forEach((members, row) => {
    inBounds('cycles.members', members, fileCount)
    if (
      members.length < 2 ||
      members.some((file, i) => i > 0 && (members[i - 1] as number) >= file)
    ) {
      fail(`cycles.members[${row}] must hold two files or more, sorted, each once`)
    }
    const shortest = cycles.shortest[row] as number[]
    const memberSet = new Set(members)
    if (
      shortest.length < 2 ||
      new Set(shortest).size !== shortest.length ||
      shortest.some((file) => !memberSet.has(file))
    ) {
      fail(`cycles.shortest[${row}] must go through two members or more, each once`)
    }
  })
  return cycles
}
