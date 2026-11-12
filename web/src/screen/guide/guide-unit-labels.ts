import type { GuideUnitLabel } from '../../city/interaction/city-guide'
import type { AnalysisResult } from '../../data/generated/AnalysisResult'
import type { Framework } from '../../data/generated/Framework'
import type { GuideUnit } from '../../guide/guide-units'
import { exactCount } from '../../ui/display/count-format'

// What the labels of the units of packages a step shows say: "web" under
// "app · Next.js · 7,878 files"; past the first ones, the name alone; past those, nothing.

/** The largest units get their figures over their name, */
export const FULL_LABELS = 6
/** the next ones their name alone, up to this many labels a step. */
export const MAX_LABELS = 16
/** A name longer than this is cut, on a label with figures, */
const FULL_NAME = 26
/** and on one without. */
const SHORT_NAME = 18
/** Past this many islands, the root says how many of the city's it stands on. */
const ROOT_SHARE_FROM = 24

const FRAMEWORKS: Record<Framework, string> = {
  nextjs: 'Next.js',
  nestjs: 'NestJS',
  reactNative: 'React Native',
  storybook: 'Storybook',
  fastify: 'Fastify',
  express: 'Express',
  fastapi: 'FastAPI',
  django: 'Django',
  flask: 'Flask',
  browserExtension: 'browser extension',
}

/** The label of each unit, in order: figures for the first ones, the name for the next, none past. */
export function guideUnitLabels(
  units: readonly GuideUnit[],
  result: AnalysisResult,
): (GuideUnitLabel | null)[] {
  return units.map((unit, at) => {
    if (at >= MAX_LABELS) {
      return null
    }
    const full = at < FULL_LABELS
    return {
      name: shortName(unitName(unit, result), full ? FULL_NAME : SHORT_NAME),
      caption: full ? unitCaption(unit, result) : null,
    }
  })
}

function unitName(unit: GuideUnit, result: AnalysisResult): string {
  switch (unit.kind) {
    case 'group':
      return result.packageGroups.prefix[unit.group ?? -1] ?? ''
    case 'root':
      return result.repo.name
    default:
      return result.packages.name[unit.packages[0] ?? -1] ?? ''
  }
}

/** "app · Next.js · 7,878 files", "library · 24 files · by 27 packages", "3 apps · 2,516 files". */
export function unitCaption(unit: GuideUnit, result: AnalysisResult): string {
  const files = filesCount(unit.codeFiles)
  if (unit.kind === 'group') {
    return `${unit.packages.length} apps · ${files}`
  }
  if (unit.kind === 'root') {
    const all = result.islands.dir.length
    const islands =
      unit.folders.length > ROOT_SHARE_FROM
        ? `${exactCount(unit.folders.length)} of ${exactCount(all)} islands`
        : `${exactCount(unit.folders.length)} islands`
    return [unit.packageKind, 'repository root', islands, files].join(' · ')
  }
  const host =
    unit.host === null
      ? null
      : unit.host === rootPackage(result)
        ? result.repo.name
        : (result.packages.name[unit.host] ?? null)
  const parts = [host === null ? unit.packageKind : `${unit.packageKind} inside ${host}`]
  if (unit.framework !== null) {
    parts.push(FRAMEWORKS[unit.framework])
  }
  parts.push(files)
  if (unit.importers !== null && unit.importers > 0) {
    parts.push(`by ${exactCount(unit.importers)} ${unit.importers === 1 ? 'package' : 'packages'}`)
  }
  return parts.join(' · ')
}

/**
 * A name cut from its start, as paths are: its last two segments after "…/", else its last,
 * else its last with its end cut.
 */
export function shortName(name: string, most: number): string {
  if (name.length <= most) {
    return name
  }
  const parts = name.split('/')
  const last = parts.at(-1) ?? name
  const two = parts.length > 2 ? `${parts.at(-2)}/${last}` : last
  for (const tail of [two, last]) {
    if (tail.length + 2 <= most) {
      return `…/${tail}`
    }
  }
  return `…/${last.slice(0, most - 3)}…`
}

function filesCount(files: number): string {
  return `${exactCount(files)} ${files === 1 ? 'file' : 'files'}`
}

function rootPackage(result: AnalysisResult): number {
  return result.packages.dir.indexOf(0)
}
