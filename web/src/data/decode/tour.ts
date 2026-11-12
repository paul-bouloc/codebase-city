// Decoder of the tour: the steps the guide shows, in order, and what they point at. Checked as in
// crates/model/src/validate/tour.rs.

import type { Tour } from '../generated/Tour'
import type { TourStep } from '../generated/TourStep'
import { fail, object } from './checks'
import { stepFields, type Tables } from './tour-fields'
import { decodePackageStep } from './tour-packages'

/** As APPS_LEAD_SHARE in crates/model/src/result.rs: apps lead with this share of the packages' code. */
const APPS_LEAD_SHARE = 10
/** As BUILT_ON_SHARE in crates/model/src/validate/tour.rs: the share of the code a dependency the project builds on is imported by. */
const BUILT_ON_SHARE = 10
/** As MIN_EXAMPLES in crates/model/src/validate/tour.rs: fewer examples that import the code make no step. */
const MIN_EXAMPLES = 10

type Kind = TourStep['kind']

// The place of each kind in the tour; checked by the compiler against the generated union.
const RANKS = {
  overview: 0,
  builtOn: 1,
  entryPoints: 2,
  conductors: 3,
  foundations: 4,
  applications: 5,
  otherApps: 6,
  libraries: 7,
  appLinks: 8,
  layers: 9,
  examplesAndTests: 10,
  consumers: 11,
  insidePackage: 12,
  cycles: 13,
  complexAreas: 14,
  rest: 15,
} satisfies Record<Kind, number>

// The kinds only one of the two tours has: a monorepo's presents its packages, another
// repository's its files.
const TOURS: Partial<Record<Kind, 'files' | 'packages'>> = {
  builtOn: 'files',
  examplesAndTests: 'files',
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
  // A tour of packages presents the main apps exactly when they lead
  const appsLead = packagesLeadByApps(tables.packages)
  const presentsApps = steps.some((step) => step.kind === 'applications')
  if (first === 'packages' && presentsApps !== appsLead) {
    fail(
      "a tour of packages must present the main apps when apps hold 10% of the packages' code, and only then",
    )
  }
  steps.forEach((step, row) => {
    // After the main apps, one more makes no list; in a monorepo of libraries, its only app is
    // worth naming
    if (step.kind === 'otherApps' && appsLead && step.apps.length < 2) {
      fail(`a list of tour.steps[${row}] must hold as many rows as its step allows, each once`)
    }
    // Inside the main app when apps lead, inside the main library otherwise
    const insideKind = appsLead ? 'app' : 'library'
    if (step.kind === 'insidePackage' && tables.packages.kind[step.package] !== insideKind) {
      fail(`tour.steps[${row}] names a library as an app, or an app as a library`)
    }
  })
  return { steps }
}

/** Whether apps lead the monorepo the packages make, as in `Packages::apps_lead`. */
function packagesLeadByApps(packages: Tables['packages']): boolean {
  let apps = 0
  let all = 0
  packages.kind.forEach((kind, row) => {
    const files = packages.codeFiles[row] ?? 0
    all += files
    if (kind === 'app') {
      apps += files
    }
  })
  return apps > 0 && apps * 100 >= all * APPS_LEAD_SHARE
}

function decodeStep(value: unknown, row: number, tables: Tables): TourStep {
  const path = `tour.steps[${row}]`
  const fields = object(value, path)
  const { count, counts, index, optional, list, holds } = stepFields(fields, path, row)
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
        docLanguages: count('docLanguages'),
      }
      const without = step.language === null && (step.languageLines > 0 || step.languageRead)
      holds(step.languageLines <= step.lines && !without && step.docLanguages !== 1)
      return step
    }
    case 'builtOn': {
      const step: TourStep = {
        kind,
        externals: list('externals', tables.externals.name.length),
        codeFiles: count('codeFiles'),
      }
      // Declared at the root for running (the root may be a package of its own), by a good share
      // of the code, the most imported first
      const { externals, files } = tables
      let previous = Number.POSITIVE_INFINITY
      for (const at of step.externals) {
        const imported = externals.files[at] as number
        const manifestDir = files.dir[externals.manifest[at] as number]
        holds(
          externals.dev[at] === false &&
            manifestDir === 0 &&
            imported <= previous &&
            imported <= step.codeFiles &&
            imported * 100 >= step.codeFiles * BUILT_ON_SHARE,
        )
        previous = imported
      }
      return step
    }
    case 'examplesAndTests': {
      const step: TourStep = {
        kind,
        folders: list('folders', tables.dirs.parent.length),
        examples: counts('examples'),
        tests: count('tests'),
      }
      // Below the root, the most examples first
      const { examples, folders } = step
      const testFiles = tables.files.scope.filter((scope) => scope === 'test').length
      holds(
        examples.length === folders.length &&
          !examples.includes(0) &&
          !folders.includes(0) &&
          examples.every((each, at) => at === 0 || each <= (examples[at - 1] as number)) &&
          examples.reduce((sum, each) => sum + each, 0) >= MIN_EXAMPLES &&
          step.tests <= testFiles,
      )
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
