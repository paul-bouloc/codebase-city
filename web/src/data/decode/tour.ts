// Decoder of the tour: the steps the guide shows, in order, and what they point at.

import type { AnalysisResult } from '../generated/AnalysisResult'
import type { Tour } from '../generated/Tour'
import type { TourStep } from '../generated/TourStep'
import { fail, inBounds, isU32List, object, u32 } from './checks'

type Kind = TourStep['kind']

// The place of each kind in the tour; checked by the compiler against the generated union.
const RANKS = {
  overview: 0,
  entryPoints: 1,
  conductors: 2,
  foundations: 3,
  layers: 4,
  cycles: 5,
  complexAreas: 6,
  rest: 7,
} satisfies Record<Kind, number>

const MAX_ROWS = 3

/** The tables a tour points into, already decoded. */
type Tables = Pick<
  AnalysisResult,
  'dirs' | 'files' | 'languages' | 'roles' | 'islands' | 'links' | 'cycles'
>

export function decodeTour(value: unknown, tables: Tables): Tour {
  const fields = object(value, 'tour')
  if (!Array.isArray(fields.steps)) {
    fail('tour.steps is not an array')
  }
  const steps = fields.steps.map((step, row) => decodeStep(step, row, tables))
  if (steps[0]?.kind !== 'overview') {
    fail('tour.steps must start with the overview')
  }
  for (let row = 1; row < steps.length; row++) {
    if (RANKS[(steps[row - 1] as TourStep).kind] >= RANKS[(steps[row] as TourStep).kind]) {
      fail(`tour.steps[${row}] must come after the previous step, each kind once, in order`)
    }
  }
  return { steps }
}

function decodeStep(value: unknown, row: number, tables: Tables): TourStep {
  const path = `tour.steps[${row}]`
  const fields = object(value, path)
  const count = (name: string) => u32(fields[name], `${path}.${name}`)
  const index = (name: string, length: number) => {
    const at = count(name)
    inBounds(`tour.${name}`, [at], length)
    return at
  }
  const optional = (name: string, length: number) =>
    fields[name] === null ? null : index(name, length)
  const list = (name: string, length: number, min = 1) => {
    const rows = fields[name]
    if (!isU32List(rows)) {
      fail(`${path}.${name} is not a list of indexes`)
    }
    if (rows.length < min || rows.length > MAX_ROWS || new Set(rows).size !== rows.length) {
      fail(`a list of ${path} must hold one to three rows, each once`)
    }
    inBounds(`tour.${name}`, rows, length)
    return rows
  }
  const islandCount = tables.islands.dir.length
  const kind = fields.kind
  switch (kind) {
    case 'overview': {
      const step: TourStep = {
        kind,
        files: count('files'),
        generated: count('generated'),
        lines: count('lines'),
        language: optional('language', tables.languages.length),
        languageLines: count('languageLines'),
        biggestIsland: optional('biggestIsland', islandCount),
        outsideIsland: optional('outsideIsland', islandCount),
      }
      if (step.languageLines > step.lines || (step.language === null && step.languageLines > 0)) {
        fail(`the counts of ${path} do not add up`)
      }
      return step
    }
    case 'entryPoints':
      return { kind, entries: list('entries', tables.roles.entries.file.length) }
    case 'conductors':
      return { kind, conductors: list('conductors', tables.roles.conductors.file.length) }
    case 'foundations':
      return {
        kind,
        foundations: list('foundations', tables.roles.foundations.file.length),
        island: optional('island', islandCount),
      }
    case 'layers':
      return {
        kind,
        down: count('down'),
        level: count('level'),
        up: count('up'),
        worstLink: optional('worstLink', tables.links.from.length),
      }
    case 'cycles':
      return {
        kind,
        cycle: index('cycle', tables.cycles.members.length),
        dir: index('dir', tables.dirs.parent.length),
      }
    case 'complexAreas':
      return {
        kind,
        files: list('files', tables.files.dir.length),
        complexity: count('complexity'),
      }
    case 'rest': {
      const step: TourStep = {
        kind,
        tests: count('tests'),
        examples: count('examples'),
        docs: count('docs'),
        config: count('config'),
        rootConfig: count('rootConfig'),
        parkCount: count('parkCount'),
        parkTests: count('parkTests'),
        parks: list('parks', tables.dirs.parent.length, 0),
      }
      if (step.parks.length > step.parkCount || step.parkTests > step.tests) {
        fail(`the counts of ${path} do not add up`)
      }
      return step
    }
    default:
      return fail(`${path}.kind is not a kind of step`)
  }
}
