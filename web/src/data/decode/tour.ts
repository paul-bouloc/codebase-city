// Decoder of the tour: the steps the guide shows, in order, and what they point at. Checked as in
// crates/model/src/validate/tour.rs.

import type { Tour } from '../generated/Tour'
import type { TourStep } from '../generated/TourStep'
import { fail, object } from './checks'
import { stepFields, type Tables } from './tour-fields'
import { decodePackageStep } from './tour-packages'

type Kind = TourStep['kind']

// The place of each kind in the tour; checked by the compiler against the generated union.
const RANKS = {
  overview: 0,
  entryPoints: 1,
  conductors: 2,
  foundations: 3,
  applications: 4,
  otherApps: 5,
  libraries: 6,
  appLinks: 7,
  layers: 8,
  consumers: 9,
  insidePackage: 10,
  cycles: 11,
  complexAreas: 12,
  rest: 13,
} satisfies Record<Kind, number>

// The kinds only one of the two tours has: a monorepo's presents its packages, another
// repository's its files.
const TOURS: Partial<Record<Kind, 'files' | 'packages'>> = {
  entryPoints: 'files',
  conductors: 'files',
  foundations: 'files',
  applications: 'packages',
  otherApps: 'packages',
  libraries: 'packages',
  appLinks: 'packages',
  consumers: 'packages',
  insidePackage: 'packages',
}

export type { Tables }

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
  let first: 'files' | 'packages' | undefined
  steps.forEach((step, row) => {
    const tour = TOURS[step.kind]
    first ??= tour
    if (tour !== undefined && tour !== first) {
      fail(
        `tour.steps[${row}] presents packages in a tour of files, or files in a tour of packages`,
      )
    }
  })
  return { steps }
}

function decodeStep(value: unknown, row: number, tables: Tables): TourStep {
  const path = `tour.steps[${row}]`
  const fields = object(value, path)
  const { count, index, optional, list, holds } = stepFields(fields, path, row)
  const boolean = (name: string) =>
    typeof fields[name] === 'boolean'
      ? (fields[name] as boolean)
      : fail(`${path}.${name} is not a boolean`)
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
        languageRead: boolean('languageRead'),
        biggestIsland: optional('biggestIsland', islandCount),
        outsideIsland: optional('outsideIsland', islandCount),
      }
      const without = step.language === null && (step.languageLines > 0 || step.languageRead)
      holds(step.languageLines <= step.lines && !without)
      return step
    }
    case 'entryPoints':
      return {
        kind,
        entries: list('entries', tables.roles.entries.file.length),
      }
    case 'conductors':
      return {
        kind,
        conductors: list('conductors', tables.roles.conductors.file.length),
      }
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
    case 'cycles': {
      const step: TourStep = {
        kind,
        cycle: index('cycle', tables.cycles.members.length),
        dir: index('dir', tables.dirs.parent.length),
        package: optional('package', tables.packages.dir.length),
        inPackage: count('inPackage'),
        crossing: count('crossing'),
      }
      const cycles = tables.cycles.members.length
      const inside =
        step.package === null
          ? step.inPackage === 0
          : step.inPackage >= 1 && step.inPackage <= cycles
      holds(inside && step.inPackage + step.crossing <= cycles)
      return step
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
      holds(step.parks.length <= step.parkCount && step.parkTests <= step.tests)
      return step
    }
    case 'applications':
    case 'otherApps':
    case 'libraries':
    case 'appLinks':
    case 'consumers':
    case 'insidePackage':
      return decodePackageStep(kind, fields, path, row, tables)
    default:
      return fail(`${path}.kind is not a kind of step`)
  }
}
