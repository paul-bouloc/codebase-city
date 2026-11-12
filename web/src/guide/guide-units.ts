import type { AnalysisResult } from '../data/generated/AnalysisResult'
import type { Framework } from '../data/generated/Framework'
import type { PackageKind } from '../data/generated/PackageKind'
import type { TourStep } from '../data/generated/TourStep'

// What a step of a monorepo's tour shows of its packages, unit by unit: an app, a library, the
// apps of a group by name, or the root package; each with the folders it stands on and the
// figures its label gives.

export type GuideUnitKind = 'app' | 'library' | 'group' | 'root'

export interface GuideUnit {
  kind: GuideUnitKind
  /** Rows of `packages`: one, or the apps of a group, the largest first. */
  packages: number[]
  /** What the root package is, or the package; apps for a group. */
  packageKind: PackageKind
  /** For a group, its row of `packageGroups`. */
  group: number | null
  /** The folders it stands on: islands, or the parcel of a package inside another's island. */
  folders: number[]
  /** For a package inside another, the row of the package that holds it. */
  host: number | null
  /** Its framework, for an app alone. */
  framework: Framework | null
  /** Production files in an analyzed language. */
  codeFiles: number
  /** Packages that import it, when the step counts them. */
  importers: number | null
}

/**
 * The units a step shows, the largest first; none for a step that shows no package. The root
 * package standing on every island gets no unit: the city is all of it.
 */
export function guideUnits(result: AnalysisResult, step: TourStep): GuideUnit[] {
  const owner = packageOfDirs(result)
  const make = (row: number, importers: number | null = null) =>
    unitOf(result, owner, row, importers)
  let units: (GuideUnit | null)[]
  switch (step.kind) {
    case 'applications':
      units = step.units.map((unit) =>
        unit.group === null || unit.apps.length < 2
          ? make(unit.apps[0] ?? -1)
          : groupOf(result, owner, unit.group, unit.apps, unit.files),
      )
      break
    case 'otherApps':
      units = step.apps.map((row) => make(row))
      break
    case 'libraries': {
      const importers = new Map(step.mostImported.map((row, at) => [row, step.importers[at]]))
      units = [...new Set([...step.mostImported, step.largest])].map((row) =>
        make(row, importers.get(row) ?? null),
      )
      break
    }
    case 'appLinks':
      units = [...new Set(step.shared.flatMap((shared) => [shared.library, ...shared.apps]))].map(
        (row) => make(row),
      )
      break
    default:
      units = []
  }
  const all = result.islands.dir.length
  return units
    .filter((unit): unit is GuideUnit => unit !== null && unit.folders.length > 0)
    .filter((unit) => unit.kind !== 'root' || unit.folders.length < all)
    .sort((a, b) => b.codeFiles - a.codeFiles)
}

/** The folders the units stand on, in order, each once. */
export function unitFolders(units: readonly GuideUnit[]): number[] {
  return [...new Set(units.flatMap((unit) => unit.folders))]
}

function unitOf(
  result: AnalysisResult,
  owner: readonly (number | null)[],
  row: number,
  importers: number | null,
): GuideUnit | null {
  const { packages } = result
  const dir = packages.dir[row]
  const kind = packages.kind[row]
  if (dir === undefined || kind === undefined) {
    return null
  }
  const root = dir === 0
  // A package inside another stands on a parcel of that one's island; an island of its own is
  // inside none, whatever folder holds it
  const parent = result.islands.dir.includes(dir) ? null : (result.dirs.parent[dir] ?? null)
  return {
    kind: root ? 'root' : kind,
    packages: [row],
    packageKind: kind,
    group: null,
    folders: root ? result.islands.dir.filter((island) => owner[island] === row) : [dir],
    host: root || parent === null ? null : (owner[parent] ?? null),
    framework: packages.framework[row] ?? null,
    codeFiles: packages.codeFiles[row] ?? 0,
    importers,
  }
}

function groupOf(
  result: AnalysisResult,
  owner: readonly (number | null)[],
  group: number,
  apps: readonly number[],
  files: number,
): GuideUnit {
  const members = apps.flatMap((row) => unitOf(result, owner, row, null) ?? [])
  return {
    kind: 'group',
    packages: [...apps],
    packageKind: 'app',
    group,
    folders: [...new Set(members.flatMap((member) => member.folders))],
    host: null,
    framework: null,
    codeFiles: files,
    importers: null,
  }
}

/** The package of each folder: the deepest that holds it. Parents come before their children. */
function packageOfDirs(result: AnalysisResult): (number | null)[] {
  const owner: (number | null)[] = result.dirs.parent.map(() => null)
  result.packages.dir.forEach((dir, row) => {
    owner[dir] = row
  })
  result.dirs.parent.forEach((parent, dir) => {
    if (owner[dir] === null && parent !== null) {
      owner[dir] = owner[parent] ?? null
    }
  })
  return owner
}
