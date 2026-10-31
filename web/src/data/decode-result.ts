import type { AnalysisResult } from './generated/AnalysisResult'
import type { Confidence } from './generated/Confidence'
import type { Dirs } from './generated/Dirs'
import type { EdgeKind } from './generated/EdgeKind'
import type { Edges } from './generated/Edges'
import type { Files } from './generated/Files'
import type { Stats } from './generated/Stats'

// FORMAT_VERSION in crates/model; the generated sample result keeps the two in step.
export const FORMAT_VERSION = 1

// Checked by the compiler against the generated unions: adding a variant in Rust breaks the build here.
const EDGE_KINDS = {
  import: true,
  type: true,
  lazy: true,
  dynamic: true,
  reexport: true,
} satisfies Record<EdgeKind, true>
const CONFIDENCES = { exact: true, likely: true } satisfies Record<Confidence, true>

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
const isEdgeKind = (item: unknown): item is EdgeKind =>
  typeof item === 'string' && Object.hasOwn(EDGE_KINDS, item)
const isConfidence = (item: unknown): item is Confidence =>
  typeof item === 'string' && Object.hasOwn(CONFIDENCES, item)

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
  return { parent, name }
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
  }
  sameLength('files.name', dir.length, files.name)
  sameLength('files.language', dir.length, files.language)
  sameLength('files.lines', dir.length, files.lines)
  sameLength('files.complexity', dir.length, files.complexity)
  sameLength('files.generated', dir.length, files.generated)
  inBounds('files.dir', dir, dirCount)
  inBounds('files.language', files.language, languageCount)
  validNames('files.name', files.name, 0)
  return files
}

function decodeEdges(value: unknown, fileCount: number): Edges {
  const fields = object(value, 'edges')
  const from = u32Column(fields.from, 'edges.from')
  const edges: Edges = {
    from,
    to: u32Column(fields.to, 'edges.to'),
    kind: column(fields.kind, 'edges.kind', isEdgeKind, 'an edge kind'),
    confidence: column(fields.confidence, 'edges.confidence', isConfidence, 'a confidence'),
  }
  sameLength('edges.to', from.length, edges.to)
  sameLength('edges.kind', from.length, edges.kind)
  sameLength('edges.confidence', from.length, edges.confidence)
  inBounds('edges.from', from, fileCount)
  inBounds('edges.to', edges.to, fileCount)
  return edges
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
  }
  if (stats.importsResolved > stats.importsTotal) {
    fail('stats.importsResolved is greater than stats.importsTotal')
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
    edges: decodeEdges(fields.edges, files.dir.length),
    stats: decodeStats(fields.stats),
  }
}
