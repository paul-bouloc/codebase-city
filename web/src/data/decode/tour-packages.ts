// Decoder of the steps of a monorepo's tour: they point at packages, of the kind each step says.

import type { PackageKind } from '../generated/PackageKind'
import type { TourStep } from '../generated/TourStep'
import { fail, object } from './checks'
import { MAX_ROWS, stepFields, type Tables } from './tour-fields'

const MAX_UNITS = 5
const MAX_MOST_IMPORTED = 4

type PackageStepKind = Extract<
  TourStep['kind'],
  'applications' | 'otherApps' | 'libraries' | 'appLinks' | 'consumers' | 'insidePackage'
>

function array(value: unknown, path: string): unknown[] {
  return Array.isArray(value) ? value : fail(`${path} is not an array`)
}

export function decodePackageStep(
  kind: PackageStepKind,
  fields: Record<string, unknown>,
  path: string,
  row: number,
  tables: Tables,
): TourStep {
  const { count, counts, index, indexes, holds } = stepFields(fields, path, row)
  const packageCount = tables.packages.dir.length
  // Packages of the kind the step says, each once
  const packages = (
    value: unknown,
    name: string,
    kindOf: PackageKind,
    min: number,
    max: number,
  ) => {
    const rows = indexes(value, name, packageCount, min, max)
    if (rows.some((at) => tables.packages.kind[at] !== kindOf)) {
      fail(`tour.steps[${row}] names a library as an app, or an app as a library`)
    }
    return rows
  }
  const tooMany = () =>
    fail(`a list of tour.steps[${row}] must hold as many rows as its step allows, each once`)
  switch (kind) {
    case 'applications': {
      const values = array(fields.units, `${path}.units`)
      if (values.length < 1 || values.length > MAX_UNITS) {
        tooMany()
      }
      const units = values.map((value, at) => {
        const unit = object(value, `${path}.units[${at}]`)
        const own = stepFields(unit, `${path}.units[${at}]`, row)
        return {
          group: own.optional('group', tables.packageGroups.prefix.length),
          apps: own.list('apps', packageCount, 1, Number.MAX_SAFE_INTEGER),
          files: own.count('files'),
        }
      })
      packages(
        units.flatMap((unit) => unit.apps),
        'apps',
        'app',
        1,
        Number.MAX_SAFE_INTEGER,
      )
      const step: TourStep = { kind, units, appFiles: count('appFiles') }
      const files = units.reduce((sum, unit) => sum + unit.files, 0)
      const largestFirst = units.every(
        (unit, at) => at === 0 || (units[at - 1]?.files ?? 0) >= unit.files,
      )
      holds(files <= step.appFiles && largestFirst)
      return step
    }
    case 'otherApps':
      // Two or more after the main apps: decodeTour checks it
      return {
        kind,
        apps: packages(fields.apps, 'apps', 'app', 1, Number.MAX_SAFE_INTEGER),
      }
    case 'libraries': {
      const all = Number.MAX_SAFE_INTEGER
      const step: TourStep = {
        kind,
        mostImported: packages(
          fields.mostImported,
          'mostImported',
          'library',
          1,
          MAX_MOST_IMPORTED,
        ),
        importers: counts('importers'),
        largest: packages([fields.largest], 'largest', 'library', 1, 1)[0] ?? 0,
        singleApp: packages(fields.singleApp, 'singleApp', 'library', 0, all),
        unused: packages(fields.unused, 'unused', 'library', 0, all),
      }
      const mostFirst = step.importers.every(
        (importers, at) => at === 0 || (step.importers[at - 1] ?? 0) >= importers,
      )
      holds(step.importers.length === step.mostImported.length && mostFirst)
      return step
    }
    case 'appLinks': {
      const values = array(fields.shared, `${path}.shared`)
      if (values.length < 1 || values.length > MAX_ROWS) {
        tooMany()
      }
      const shared = values.map((value, at) => {
        const each = object(value, `${path}.shared[${at}]`)
        const own = stepFields(each, `${path}.shared[${at}]`, row)
        return {
          library: own.count('library'),
          apps: packages(each.apps, 'apps', 'app', 2, Number.MAX_SAFE_INTEGER),
          files: own.count('files'),
          typeOnly: own.count('typeOnly'),
        }
      })
      packages(
        shared.map((each) => each.library),
        'library',
        'library',
        1,
        MAX_ROWS,
      )
      holds(shared.every((each) => each.typeOnly <= each.files))
      return { kind, appImports: count('appImports'), shared }
    }
    case 'consumers': {
      const values = array(fields.folders, `${path}.folders`)
      if (values.length < 1 || values.length > MAX_ROWS) {
        tooMany()
      }
      const folders = values.map((value, at) => {
        const own = stepFields(
          object(value, `${path}.folders[${at}]`),
          `${path}.folders[${at}]`,
          row,
        )
        return {
          dir: own.count('dir'),
          folders: own.count('folders'),
          imports: own.count('imports'),
        }
      })
      indexes(
        folders.map((folder) => folder.dir),
        'dir',
        tables.dirs.parent.length,
        1,
        MAX_ROWS,
      )
      return { kind, folders, package: index('package', packageCount) }
    }
    case 'insidePackage': {
      const step: TourStep = {
        kind,
        package: index('package', packageCount),
        dirs: indexes(fields.dirs, 'dirs', tables.dirs.parent.length, 1, MAX_ROWS),
        files: counts('files'),
      }
      holds(step.files.length === step.dirs.length)
      return step
    }
  }
}
