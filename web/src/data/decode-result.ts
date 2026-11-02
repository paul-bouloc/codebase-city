import type { AnalysisResult } from './generated/AnalysisResult'
import type { Confidence } from './generated/Confidence'
import type { Cycles } from './generated/Cycles'
import type { Dirs } from './generated/Dirs'
import type { EdgeKind } from './generated/EdgeKind'
import type { Edges } from './generated/Edges'
import type { Entries } from './generated/Entries'
import type { EntryReason } from './generated/EntryReason'
import type { Files } from './generated/Files'
import type { Grids } from './generated/Grids'
import type { Islands } from './generated/Islands'
import type { Layout } from './generated/Layout'
import type { Links } from './generated/Links'
import type { ParcelNature } from './generated/ParcelNature'
import type { Parcels } from './generated/Parcels'
import type { Ranked } from './generated/Ranked'
import type { Rects } from './generated/Rects'
import type { Roles } from './generated/Roles'
import type { Scope } from './generated/Scope'
import type { Stats } from './generated/Stats'
import type { SymbolKind } from './generated/SymbolKind'
import type { Symbols } from './generated/Symbols'

// FORMAT_VERSION in crates/model; the generated sample result keeps the two in step.
export const FORMAT_VERSION = 7

// Checked by the compiler against the generated unions: adding a variant in Rust breaks the build here.
const EDGE_KINDS = {
  import: true,
  type: true,
  lazy: true,
  dynamic: true,
  reexport: true,
} satisfies Record<EdgeKind, true>
const CONFIDENCES = { exact: true, likely: true } satisfies Record<Confidence, true>
const SCOPES = {
  source: true,
  test: true,
  fixture: true,
  example: true,
  docs: true,
  bench: true,
  build: true,
  config: true,
} satisfies Record<Scope, true>
const ENTRY_REASONS = {
  packageBin: true,
  packageMain: true,
  packageScript: true,
  pyprojectScript: true,
  setupCfgScript: true,
  goMain: true,
  mainModule: true,
  mainBlock: true,
  framework: true,
  conventionalName: true,
  noImporter: true,
} satisfies Record<EntryReason, true>
const SYMBOL_KINDS = {
  class: true,
  function: true,
  interface: true,
  type: true,
  enum: true,
  constant: true,
} satisfies Record<SymbolKind, true>

const PARCEL_NATURES = { normal: true, tests: true, unanalyzed: true } satisfies Record<
  ParcelNature,
  true
>

const MAX_U32 = 2 ** 32 - 1

export class InvalidResultError extends Error {
  override name = 'InvalidResultError'
}

function fail(message: string): never {
  throw new InvalidResultError(message)
}

type Fields = Record<string, unknown>

function object(value: unknown, path: string): Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${path} is not an object`)
  }
  return value as Fields
}

function isU32(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_U32
}

function u32(value: unknown, path: string): number {
  return isU32(value) ? value : fail(`${path} is not an unsigned 32-bit integer`)
}

function string(value: unknown, path: string): string {
  return typeof value === 'string' ? value : fail(`${path} is not a string`)
}

function column<T>(
  value: unknown,
  path: string,
  isItem: (item: unknown) => item is T,
  expected: string,
): T[] {
  if (!Array.isArray(value)) {
    fail(`${path} is not an array`)
  }
  const row = value.findIndex((item) => !isItem(item))
  if (row !== -1) {
    fail(`${path}[${row}] is not ${expected}`)
  }
  return value as T[]
}

const isString = (item: unknown): item is string => typeof item === 'string'
const isBoolean = (item: unknown): item is boolean => typeof item === 'boolean'
const isU32OrNull = (item: unknown): item is number | null => item === null || isU32(item)
const isStringOrNull = (item: unknown): item is string | null =>
  item === null || typeof item === 'string'
const isEdgeKind = (item: unknown): item is EdgeKind =>
  typeof item === 'string' && Object.hasOwn(EDGE_KINDS, item)
const isConfidence = (item: unknown): item is Confidence =>
  typeof item === 'string' && Object.hasOwn(CONFIDENCES, item)
const isSymbolKind = (item: unknown): item is SymbolKind =>
  typeof item === 'string' && Object.hasOwn(SYMBOL_KINDS, item)
const isParcelNature = (item: unknown): item is ParcelNature =>
  typeof item === 'string' && Object.hasOwn(PARCEL_NATURES, item)
const isScope = (item: unknown): item is Scope =>
  typeof item === 'string' && Object.hasOwn(SCOPES, item)
const isU32List = (item: unknown): item is number[] => Array.isArray(item) && item.every(isU32)
const isEntryReasons = (item: unknown): item is EntryReason[] =>
  Array.isArray(item) &&
  item.every((reason) => typeof reason === 'string' && Object.hasOwn(ENTRY_REASONS, reason))

const u32Column = (value: unknown, path: string) =>
  column(value, path, isU32, 'an unsigned 32-bit integer')
const stringColumn = (value: unknown, path: string) => column(value, path, isString, 'a string')

function sameLength(path: string, expected: number, actual: unknown[]): void {
  if (actual.length !== expected) {
    fail(`column ${path} has ${actual.length} rows, expected ${expected}`)
  }
}

function inBounds(path: string, indexes: number[], length: number): void {
  const row = indexes.findIndex((index) => index >= length)
  if (row !== -1) {
    fail(`${path}[${row}] points to row ${indexes[row]}, but the table has ${length} rows`)
  }
}

function inBoundsOrNull(path: string, indexes: (number | null)[], length: number): void {
  const row = indexes.findIndex((index) => index !== null && index >= length)
  if (row !== -1) {
    fail(`${path}[${row}] points to row ${indexes[row]}, but the table has ${length} rows`)
  }
}

function isSegment(name: string): boolean {
  return name !== '' && !name.includes('/') && name !== '.' && name !== '..'
}

function validNames(path: string, names: string[], firstRow: number): void {
  for (let row = firstRow; row < names.length; row++) {
    if (!isSegment(names[row] as string)) {
      fail(`${path}[${row}] is not a valid name`)
    }
  }
}

function decodeDirs(value: unknown): Dirs {
  const fields = object(value, 'dirs')
  const parent = column(fields.parent, 'dirs.parent', isU32OrNull, 'an index or null')
  const name = stringColumn(fields.name, 'dirs.name')
  const island = column(fields.island, 'dirs.island', isU32OrNull, 'an index or null')
  sameLength('dirs.name', parent.length, name)
  if (parent[0] !== null || name[0] !== '') {
    fail('the first folder must be the root: no parent and an empty name')
  }
  for (let row = 1; row < parent.length; row++) {
    // Parents come first, so the tree has one root and no loop
    const index = parent[row]
    if (index === null || index === undefined || index >= row) {
      fail(`dirs.parent[${row}] must point to an earlier folder`)
    }
  }
  validNames('dirs.name', name, 1)
  sameLength('dirs.island', parent.length, island)
  return { parent, name, island }
}

function decodeFiles(value: unknown, dirCount: number, languageCount: number): Files {
  const fields = object(value, 'files')
  const dir = u32Column(fields.dir, 'files.dir')
  const files: Files = {
    dir,
    name: stringColumn(fields.name, 'files.name'),
    language: u32Column(fields.language, 'files.language'),
    lines: u32Column(fields.lines, 'files.lines'),
    complexity: column(fields.complexity, 'files.complexity', isU32OrNull, 'an integer or null'),
    generated: column(fields.generated, 'files.generated', isBoolean, 'a boolean'),
    header: column(fields.header, 'files.header', isStringOrNull, 'a string or null'),
    scope: column(fields.scope, 'files.scope', isScope, 'a scope'),
    barrel: column(fields.barrel, 'files.barrel', isBoolean, 'a boolean'),
    dependents: column(fields.dependents, 'files.dependents', isU32OrNull, 'an integer or null'),
    dependencies: column(
      fields.dependencies,
      'files.dependencies',
      isU32OrNull,
      'an integer or null',
    ),
  }
  sameLength('files.name', dir.length, files.name)
  sameLength('files.language', dir.length, files.language)
  sameLength('files.lines', dir.length, files.lines)
  sameLength('files.complexity', dir.length, files.complexity)
  sameLength('files.generated', dir.length, files.generated)
  sameLength('files.header', dir.length, files.header)
  sameLength('files.scope', dir.length, files.scope)
  sameLength('files.barrel', dir.length, files.barrel)
  sameLength('files.dependents', dir.length, files.dependents)
  sameLength('files.dependencies', dir.length, files.dependencies)
  inBounds('files.dir', dir, dirCount)
  inBounds('files.language', files.language, languageCount)
  validNames('files.name', files.name, 0)
  return files
}

function decodeSymbols(value: unknown, fileCount: number): Symbols {
  const fields = object(value, 'symbols')
  const file = u32Column(fields.file, 'symbols.file')
  const symbols: Symbols = {
    file,
    name: stringColumn(fields.name, 'symbols.name'),
    kind: column(fields.kind, 'symbols.kind', isSymbolKind, 'a symbol kind'),
    line: u32Column(fields.line, 'symbols.line'),
  }
  sameLength('symbols.name', file.length, symbols.name)
  sameLength('symbols.kind', file.length, symbols.kind)
  sameLength('symbols.line', file.length, symbols.line)
  inBounds('symbols.file', file, fileCount)
  const emptyName = symbols.name.indexOf('')
  if (emptyName !== -1) {
    fail(`symbols.name[${emptyName}] is empty`)
  }
  const lineZero = symbols.line.indexOf(0)
  if (lineZero !== -1) {
    fail(`symbols.line[${lineZero}] must be 1 or more`)
  }
  for (let row = 1; row < file.length; row++) {
    const previousFile = file[row - 1] as number
    const currentFile = file[row] as number
    if (
      previousFile > currentFile ||
      (previousFile === currentFile &&
        (symbols.line[row - 1] as number) > (symbols.line[row] as number))
    ) {
      fail(`symbols[${row}] must come after the previous symbol, by file then line`)
    }
  }
  return symbols
}

function decodeEdges(value: unknown, fileCount: number, dirCount: number): Edges {
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

function decodeRoles(value: unknown, fileCount: number, dirCount: number): Roles {
  const fields = object(value, 'roles')
  return {
    entries: decodeEntries(fields.entries, fileCount, dirCount),
    foundations: decodeRanked(fields.foundations, 'roles.foundations', fileCount, dirCount),
    conductors: decodeRanked(fields.conductors, 'roles.conductors', fileCount, dirCount),
  }
}

// Islands are connected parts of the folder tree, each starting at the folder it is named after.
function decodeIslands(value: unknown, dirs: Dirs): Islands {
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

function decodeLinks(value: unknown, layers: (number | null)[]): Links {
  const islandCount = layers.length
  const fields = object(value, 'links')
  const links: Links = {
    from: u32Column(fields.from, 'links.from'),
    to: u32Column(fields.to, 'links.to'),
    imports: u32Column(fields.imports, 'links.imports'),
    upward: u32Column(fields.upward, 'links.upward'),
  }
  sameLength('links.to', links.from.length, links.to)
  sameLength('links.imports', links.from.length, links.imports)
  sameLength('links.upward', links.from.length, links.upward)
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
  }
  return links
}

function decodeCycles(value: unknown, fileCount: number): Cycles {
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

/** Lots are 2 × 2 u, in tenths. */
const LOT = 20

interface Box {
  x: number
  y: number
  width: number
  height: number
}

function contains(outer: Box, inner: Box): boolean {
  return (
    inner.width > 0 &&
    inner.height > 0 &&
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function decodeRects(value: unknown, path: string, count: number): Rects {
  const fields = object(value, path)
  const rects: Rects = {
    x: u32Column(fields.x, `${path}.x`),
    y: u32Column(fields.y, `${path}.y`),
    width: u32Column(fields.width, `${path}.width`),
    height: u32Column(fields.height, `${path}.height`),
  }
  sameLength(`${path}.x`, count, rects.x)
  sameLength(`${path}.y`, count, rects.y)
  sameLength(`${path}.width`, count, rects.width)
  sameLength(`${path}.height`, count, rects.height)
  return rects
}

function box(rects: Rects, row: number): Box {
  return {
    x: rects.x[row] as number,
    y: rects.y[row] as number,
    width: rects.width[row] as number,
    height: rects.height[row] as number,
  }
}

/**
 * Islands lie in the city, parcels and grids in their island or parent
 * parcel without overlapping, and each file on a lot of its folder's grid.
 */
function decodeLayout(value: unknown, dirs: Dirs, islands: Islands, files: Files): Layout {
  const fields = object(value, 'layout')
  const dirCount = dirs.parent.length
  const plateaux = decodeRects(fields.islands, 'layout.islands', islands.dir.length)
  const parcelFields = object(fields.parcels, 'layout.parcels')
  const parcelDirs = u32Column(parcelFields.dir, 'layout.parcels.dir')
  const parcels: Parcels = {
    dir: parcelDirs,
    ...decodeRects(parcelFields, 'layout.parcels', parcelDirs.length),
    nature: column(parcelFields.nature, 'layout.parcels.nature', isParcelNature, 'a nature'),
  }
  sameLength('layout.parcels.nature', parcelDirs.length, parcels.nature)
  inBounds('layout.parcels.dir', parcels.dir, dirCount)
  const gridFields = object(fields.grids, 'layout.grids')
  const grids: Grids = {
    dir: u32Column(gridFields.dir, 'layout.grids.dir'),
    x: u32Column(gridFields.x, 'layout.grids.x'),
    y: u32Column(gridFields.y, 'layout.grids.y'),
    columns: u32Column(gridFields.columns, 'layout.grids.columns'),
    rows: u32Column(gridFields.rows, 'layout.grids.rows'),
  }
  const gridCount = grids.dir.length
  sameLength('layout.grids.x', gridCount, grids.x)
  sameLength('layout.grids.y', gridCount, grids.y)
  sameLength('layout.grids.columns', gridCount, grids.columns)
  sameLength('layout.grids.rows', gridCount, grids.rows)
  inBounds('layout.grids.dir', grids.dir, dirCount)
  const lotFields = object(fields.lots, 'layout.lots')
  const lots = {
    x: u32Column(lotFields.x, 'layout.lots.x'),
    y: u32Column(lotFields.y, 'layout.lots.y'),
  }
  sameLength('layout.lots.x', files.dir.length, lots.x)
  sameLength('layout.lots.y', files.dir.length, lots.y)
  for (const [table, dirColumn] of [
    ['layout.parcels', parcels.dir],
    ['layout.grids', grids.dir],
  ] as const) {
    for (let row = 1; row < dirColumn.length; row++) {
      if ((dirColumn[row - 1] as number) >= (dirColumn[row] as number)) {
        fail(`${table}[${row}] must come after the previous row, by folder`)
      }
    }
  }

  const own = new Array<number>(dirCount).fill(0)
  for (const dir of files.dir) {
    own[dir] = (own[dir] as number) + 1
  }
  const below = [...own]
  for (let dir = dirCount - 1; dir > 0; dir--) {
    const parent = dirs.parent[dir]
    if (parent !== null && parent !== undefined) {
      below[parent] = (below[parent] as number) + (below[dir] as number)
    }
  }
  const parcelOf = new Map(parcels.dir.map((dir, row) => [dir, row]))
  const container = (dir: number): Box | null => {
    const island = dirs.island[dir]
    if (island === null || island === undefined) {
      return null
    }
    if (islands.dir[island] === dir) {
      return box(plateaux, island)
    }
    const row = parcelOf.get(dir)
    return row === undefined ? null : box(parcels, row)
  }
  const width = u32(fields.width, 'layout.width')
  const height = u32(fields.height, 'layout.height')
  const city = { x: 0, y: 0, width, height }
  // The rectangles that share a container: the islands of the city, or what
  // holds a folder's content
  const groups = new Map<number, { table: string; row: number; box: Box }[]>()
  const join = (key: number, table: string, row: number, rect: Box) => {
    const group = groups.get(key) ?? []
    group.push({ table, row, box: rect })
    groups.set(key, group)
  }
  for (let island = 0; island < islands.dir.length; island++) {
    if (!contains(city, box(plateaux, island))) {
      fail(`layout.islands[${island}] must have a size and lie inside its island, parcel or city`)
    }
    join(-1, 'layout.islands', island, box(plateaux, island))
  }
  parcels.dir.forEach((dir, row) => {
    const island = dirs.island[dir]
    const parent = dirs.parent[dir]
    const valid =
      (below[dir] as number) > 0 &&
      island !== null &&
      island !== undefined &&
      islands.dir[island] !== dir
    const outer = valid && parent !== null && parent !== undefined ? container(parent) : null
    if (outer === null || parent === null || parent === undefined) {
      fail(
        `layout.parcels.dir[${row}] must be a folder with files, inside an island, not the one the island is named after, whose parent has a parcel or is that folder`,
      )
    }
    if (!contains(outer, box(parcels, row))) {
      fail(`layout.parcels[${row}] must have a size and lie inside its island, parcel or city`)
    }
    join(parent, 'layout.parcels', row, box(parcels, row))
  })
  grids.dir.forEach((dir, row) => {
    const outer = (own[dir] as number) > 0 ? container(dir) : null
    if (outer === null) {
      fail(`layout.grids.dir[${row}] must be a folder of an island with files of its own`)
    }
    const rect = {
      x: grids.x[row] as number,
      y: grids.y[row] as number,
      width: (grids.columns[row] as number) * LOT,
      height: (grids.rows[row] as number) * LOT,
    }
    if (!contains(outer, rect)) {
      fail(`layout.grids[${row}] must have a size and lie inside its island, parcel or city`)
    }
    join(dir, 'layout.grids', row, rect)
  })
  for (const group of groups.values()) {
    group.sort((a, b) => a.box.x - b.box.x)
    group.forEach((item, index) => {
      // Indexed rather than sliced: a slice copies the rest of the group on every item.
      for (let next = index + 1; next < group.length; next++) {
        const other = group[next] as (typeof group)[number]
        if (other.box.x >= item.box.x + item.box.width) {
          break
        }
        if (overlaps(item.box, other.box)) {
          fail(
            `${other.table}[${other.row}] overlaps another rectangle of the same island or parcel`,
          )
        }
      }
    })
  }

  const gridOf = new Map(grids.dir.map((dir, row) => [dir, row]))
  const onAxis = (at: number, start: number, count: number) => {
    const offset = at - start - LOT / 2
    return offset >= 0 && offset % LOT === 0 && offset / LOT < count
  }
  const taken = new Set<string>()
  files.dir.forEach((dir, row) => {
    const grid = gridOf.get(dir)
    const x = lots.x[row] as number
    const y = lots.y[row] as number
    if (
      grid === undefined ||
      !onAxis(x, grids.x[grid] as number, grids.columns[grid] as number) ||
      !onAxis(y, grids.y[grid] as number, grids.rows[grid] as number)
    ) {
      fail(`layout.lots[${row}] must be the centre of a lot of its folder's grid`)
    }
    const key = `${x},${y}`
    if (taken.has(key)) {
      fail(`layout.lots[${row}] shares its lot with another file`)
    }
    taken.add(key)
  })
  return { width, height, islands: plateaux, parcels, grids, lots }
}

function decodeStats(value: unknown): Stats {
  const fields = object(value, 'stats')
  const ignored = object(fields.ignored, 'stats.ignored')
  const stats: Stats = {
    ignored: {
      vendored: u32(ignored.vendored, 'stats.ignored.vendored'),
      minified: u32(ignored.minified, 'stats.ignored.minified'),
      binary: u32(ignored.binary, 'stats.ignored.binary'),
    },
    importsTotal: u32(fields.importsTotal, 'stats.importsTotal'),
    importsResolved: u32(fields.importsResolved, 'stats.importsResolved'),
    importsExternal: u32(fields.importsExternal, 'stats.importsExternal'),
  }
  if (stats.importsResolved + stats.importsExternal > stats.importsTotal) {
    fail('stats.importsResolved and stats.importsExternal add up to more than stats.importsTotal')
  }
  return stats
}

/**
 * Turns a parsed JSON analysis result into a typed one, or throws an
 * InvalidResultError. Runs the same consistency checks as the Rust model
 * (crates/model/src/validate.rs), so the rest of the app can trust the indexes.
 */
export function decodeResult(json: unknown): AnalysisResult {
  const fields = object(json, 'result')
  const formatVersion = u32(fields.formatVersion, 'formatVersion')
  if (formatVersion !== FORMAT_VERSION) {
    fail(`unsupported format version ${formatVersion}, expected ${FORMAT_VERSION}`)
  }
  const repo = object(fields.repo, 'repo')
  const dirs = decodeDirs(fields.dirs)
  const languages = stringColumn(fields.languages, 'languages')
  const files = decodeFiles(fields.files, dirs.parent.length, languages.length)
  const islands = decodeIslands(fields.islands, dirs)
  return {
    formatVersion,
    analyzerVersion: string(fields.analyzerVersion, 'analyzerVersion'),
    repo: {
      owner: string(repo.owner, 'repo.owner'),
      name: string(repo.name, 'repo.name'),
    },
    sha: string(fields.sha, 'sha'),
    dirs,
    languages,
    files,
    symbols: decodeSymbols(fields.symbols, files.dir.length),
    edges: decodeEdges(fields.edges, files.dir.length, dirs.parent.length),
    roles: decodeRoles(fields.roles, files.dir.length, dirs.parent.length),
    islands,
    links: decodeLinks(fields.links, islands.layer),
    cycles: decodeCycles(fields.cycles, files.dir.length),
    layout: decodeLayout(fields.layout, dirs, islands, files),
    stats: decodeStats(fields.stats),
  }
}
