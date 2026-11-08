// Checks shared by the decoders: each failure names the column and row at fault.

import type { Confidence } from '../generated/Confidence'
import type { EdgeKind } from '../generated/EdgeKind'
import type { EntryReason } from '../generated/EntryReason'
import type { ParcelNature } from '../generated/ParcelNature'
import type { Scope } from '../generated/Scope'
import type { SymbolKind } from '../generated/SymbolKind'

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

export function fail(message: string): never {
  throw new InvalidResultError(message)
}

type Fields = Record<string, unknown>

export function object(value: unknown, path: string): Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${path} is not an object`)
  }
  return value as Fields
}

function isU32(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_U32
}

export function u32(value: unknown, path: string): number {
  return isU32(value) ? value : fail(`${path} is not an unsigned 32-bit integer`)
}

export function string(value: unknown, path: string): string {
  return typeof value === 'string' ? value : fail(`${path} is not a string`)
}

export function column<T>(
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
export const isBoolean = (item: unknown): item is boolean => typeof item === 'boolean'
export const isU32OrNull = (item: unknown): item is number | null => item === null || isU32(item)
export const isStringOrNull = (item: unknown): item is string | null =>
  item === null || typeof item === 'string'
export const isEdgeKind = (item: unknown): item is EdgeKind =>
  typeof item === 'string' && Object.hasOwn(EDGE_KINDS, item)
export const isConfidence = (item: unknown): item is Confidence =>
  typeof item === 'string' && Object.hasOwn(CONFIDENCES, item)
export const isSymbolKind = (item: unknown): item is SymbolKind =>
  typeof item === 'string' && Object.hasOwn(SYMBOL_KINDS, item)
export const isParcelNature = (item: unknown): item is ParcelNature =>
  typeof item === 'string' && Object.hasOwn(PARCEL_NATURES, item)
export const isScope = (item: unknown): item is Scope =>
  typeof item === 'string' && Object.hasOwn(SCOPES, item)
export const isU32List = (item: unknown): item is number[] =>
  Array.isArray(item) && item.every(isU32)
export const isEntryReasons = (item: unknown): item is EntryReason[] =>
  Array.isArray(item) &&
  item.every((reason) => typeof reason === 'string' && Object.hasOwn(ENTRY_REASONS, reason))

export const u32Column = (value: unknown, path: string) =>
  column(value, path, isU32, 'an unsigned 32-bit integer')
export const stringColumn = (value: unknown, path: string) =>
  column(value, path, isString, 'a string')

export function sameLength(path: string, expected: number, actual: unknown[]): void {
  if (actual.length !== expected) {
    fail(`column ${path} has ${actual.length} rows, expected ${expected}`)
  }
}

export function inBounds(path: string, indexes: number[], length: number): void {
  const row = indexes.findIndex((index) => index >= length)
  if (row !== -1) {
    fail(`${path}[${row}] points to row ${indexes[row]}, but the table has ${length} rows`)
  }
}

export function inBoundsOrNull(path: string, indexes: (number | null)[], length: number): void {
  const row = indexes.findIndex((index) => index !== null && index >= length)
  if (row !== -1) {
    fail(`${path}[${row}] points to row ${indexes[row]}, but the table has ${length} rows`)
  }
}

function isSegment(name: string): boolean {
  return name !== '' && !name.includes('/') && name !== '.' && name !== '..'
}

export function validNames(path: string, names: string[], firstRow: number): void {
  for (let row = firstRow; row < names.length; row++) {
    if (!isSegment(names[row] as string)) {
      fail(`${path}[${row}] is not a valid name`)
    }
  }
}
