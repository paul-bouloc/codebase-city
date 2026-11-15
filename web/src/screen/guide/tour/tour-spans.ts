import type { Framework } from '../../../data/generated/Framework'
import { type GuideUnit, packageUnit } from '../../../guide/guide-units'
import { exactCount, percent } from '../../../ui/display/count-format'
import { islandNames } from '../../labels/area-label-texts'
import type { ResultIndex } from '../../result-index'
import { FRAMEWORKS } from '../guide-unit-labels'

// The pieces the sentences of the tour are made of: words, names that are not links, and chips
// that fly to a file, a folder, or the islands of a package.

/** Where a chip leads: a file or a folder it selects, or islands it frames. */
export type TourTarget =
  | { kind: 'file'; path: string }
  | { kind: 'folder'; path: string }
  | { kind: 'islands'; folders: readonly string[] }
  | { kind: 'next' }

export type TourSpan =
  | string
  /** The repository's name, in bold mono: not a link. */
  | { kind: 'repo'; text: string }
  /** A name from the code or a manifest, in mono: not a link. */
  | { kind: 'code'; text: string }
  | { kind: 'file'; path: string }
  /** A folder; the root, named after the repository. */
  | { kind: 'folder'; path: string }
  /** A package, a group of apps or an island; `count` for a group ("billing ×3"). */
  | { kind: 'island'; name: string; folders: readonly string[]; count: number | null }

export type IslandSpan = Extract<TourSpan, { kind: 'island' }>

/** A button under LOOK CLOSER. */
export interface TourChip {
  target: TourTarget
  spans: TourSpan[]
}

/** What a step says, and the chips under it. */
export interface StepText {
  text: TourSpan[]
  closer: TourChip[]
}

export interface TourText extends StepText {
  title: string
}

/** What the templates read from a result, worked out once per city. */
export interface TourContext {
  index: ResultIndex
  /** Each island's name, as its label gives it. */
  islandNames: readonly string[]
  /** Each island's files. */
  islandFiles: readonly number[]
}

export function tourContext(index: ResultIndex): TourContext {
  const { result } = index
  const paths = result.islands.dir.map((dir) => index.folderPaths[dir] ?? '/')
  const names = islandNames(paths).map((name, at) => (paths[at] === '/' ? result.repo.name : name))
  const islandFiles = result.islands.dir.map(() => 0)
  result.files.dir.forEach((_, file) => {
    const island = index.islandOfFile(file)
    if (island !== null) {
      islandFiles[island] = (islandFiles[island] ?? 0) + 1
    }
  })
  return { index, islandNames: names, islandFiles }
}

/** A file's chip; a file the result does not have is no chip, and flies nowhere. */
export function fileSpan(context: TourContext, file: number): TourSpan {
  const path = context.index.filePaths[file]
  return path === undefined ? '' : { kind: 'file', path }
}

/** A folder's chip, the root's included; a folder the result does not have is none. */
export function folderSpan(context: TourContext, dir: number): TourSpan {
  const path = context.index.folderPaths[dir]
  return path === undefined ? '' : { kind: 'folder', path }
}

/** A file, or a Go package's folder, as a ranking's row points at it; none for neither. */
export function targetSpan(
  context: TourContext,
  file: number | null,
  dir: number | null,
): TourSpan {
  if (file !== null) {
    return fileSpan(context, file)
  }
  return dir === null ? '' : folderSpan(context, dir)
}

export function islandSpan(context: TourContext, island: number): IslandSpan {
  const dir = context.index.result.islands.dir[island] ?? 0
  return {
    kind: 'island',
    name: context.islandNames[island] ?? '',
    folders: [context.index.folderPaths[dir] ?? '/'],
    count: null,
  }
}

/** A unit of packages: a package, a group of apps ("billing ×3"), or the root. */
export function unitSpan(context: TourContext, unit: GuideUnit): IslandSpan {
  const { result, folderPaths } = context.index
  const name =
    unit.kind === 'group'
      ? (result.packageGroups.prefix[unit.group ?? -1] ?? '')
      : unit.kind === 'root'
        ? result.repo.name
        : (result.packages.name[unit.packages[0] ?? -1] ?? '')
  return {
    kind: 'island',
    name,
    folders: unit.folders.map((dir) => folderPaths[dir] ?? '/'),
    count: unit.kind === 'group' ? unit.packages.length : null,
  }
}

/** A package by its row: its name, flying to its islands. */
export function packageSpan(context: TourContext, row: number): TourSpan {
  const unit = packageUnit(context.index.result, row)
  return unit ? unitSpan(context, unit) : (context.index.result.packages.name[row] ?? '')
}

/** The target of a chip that names this span. */
export function spanTarget(span: TourSpan): TourTarget | null {
  if (typeof span === 'string') {
    return null
  }
  switch (span.kind) {
    case 'file':
    case 'folder':
      return span
    case 'island':
      return { kind: 'islands', folders: span.folders }
    default:
      return null
  }
}

/** A chip that leads where its first span does. */
export function chip(spans: TourSpan[]): TourChip[] {
  for (const span of spans) {
    const target = spanTarget(span)
    if (target) {
      return [{ target, spans }]
    }
  }
  return []
}

/** "a", "a and b", "a, b and c". */
export function listed(items: readonly TourSpan[][]): TourSpan[] {
  return items.flatMap((item, at) => {
    if (at === 0) {
      return item
    }
    return [at === items.length - 1 ? ' and ' : ', ', ...item]
  })
}

/** "1 file", "1,204 files". */
export function counted(count: number, one: string, many = `${one}s`): string {
  return `${exactCount(count)} ${count === 1 ? one : many}`
}

/** "1 file", "12 files". */
export const files = (count: number) => counted(count, 'file')

/**
 * A share that never lies at the edges: "<1%", "94%", and close to all "99.9%" rather than a
 * rounded "100%".
 */
export function share(part: number, whole: number): string {
  if (whole <= 0) {
    return '0%'
  }
  const value = part / whole
  if (value > 0.99 && value < 1) {
    return `${Math.floor(value * 1000) / 10}%`
  }
  return percent(value)
}

export function frameworkName(framework: Framework | null): string | null {
  return framework === null ? null : FRAMEWORKS[framework]
}
