import type { Externals } from '../generated/Externals'
import type { Framework } from '../generated/Framework'
import type { PackageGroups } from '../generated/PackageGroups'
import type { PackageKind } from '../generated/PackageKind'
import type { Packages } from '../generated/Packages'
import type { Workspace } from '../generated/Workspace'
import type { WorkspaceKind } from '../generated/WorkspaceKind'
import {
  column,
  fail,
  inBounds,
  inBoundsOrNull,
  isBoolean,
  isU32OrNull,
  object,
  sameLength,
  stringColumn,
  u32,
  u32Column,
} from './checks'

// Checked by the compiler against the generated unions: adding a variant in Rust breaks the build here.
const WORKSPACE_KINDS = {
  npm: true,
  pnpm: true,
  lerna: true,
  goWork: true,
  uv: true,
  nx: true,
  deno: true,
} satisfies Record<WorkspaceKind, true>
const PACKAGE_KINDS = { app: true, library: true } satisfies Record<PackageKind, true>
const FRAMEWORKS = {
  nextjs: true,
  nestjs: true,
  reactNative: true,
  storybook: true,
  fastify: true,
  express: true,
  fastapi: true,
  django: true,
  flask: true,
  browserExtension: true,
} satisfies Record<Framework, true>

const isPackageKind = (item: unknown): item is PackageKind =>
  typeof item === 'string' && Object.hasOwn(PACKAGE_KINDS, item)
const isFrameworkOrNull = (item: unknown): item is Framework | null =>
  item === null || (typeof item === 'string' && Object.hasOwn(FRAMEWORKS, item))

export interface PackageSections {
  workspaces: Workspace[]
  packages: Packages
  packageGroups: PackageGroups
  externals: Externals
}

/** The workspaces, packages, groups and externals, checked as in crates/model/src/validate/packages.rs. */
export function decodePackages(
  fields: Record<string, unknown>,
  dirParents: (number | null)[],
  fileCount: number,
): PackageSections {
  const dirCount = dirParents.length
  const workspaces = decodeWorkspaces(fields.workspaces, fileCount)

  const value = object(fields.packages, 'packages')
  const dir = u32Column(value.dir, 'packages.dir')
  const packages: Packages = {
    dir,
    name: stringColumn(value.name, 'packages.name'),
    kind: column(value.kind, 'packages.kind', isPackageKind, 'a package kind'),
    framework: column(
      value.framework,
      'packages.framework',
      isFrameworkOrNull,
      'a framework or null',
    ),
    manifest: column(value.manifest, 'packages.manifest', isU32OrNull, 'an index or null'),
    group: column(value.group, 'packages.group', isU32OrNull, 'an index or null'),
    codeFiles: u32Column(value.codeFiles, 'packages.codeFiles'),
    entry: column(value.entry, 'packages.entry', isU32OrNull, 'an index or null'),
    routes: column(value.routes, 'packages.routes', isU32OrNull, 'an index or null'),
    routeCount: u32Column(value.routeCount, 'packages.routeCount'),
    apiRouteCount: u32Column(value.apiRouteCount, 'packages.apiRouteCount'),
  }
  for (const key of [
    'name',
    'kind',
    'framework',
    'manifest',
    'group',
    'codeFiles',
    'entry',
    'routes',
    'routeCount',
    'apiRouteCount',
  ] as const) {
    sameLength(`packages.${key}`, dir.length, packages[key])
  }
  inBounds('packages.dir', dir, dirCount)
  inBoundsOrNull('packages.manifest', packages.manifest, fileCount)
  inBoundsOrNull('packages.entry', packages.entry, fileCount)
  inBoundsOrNull('packages.routes', packages.routes, dirCount)

  const groupFields = object(fields.packageGroups, 'packageGroups')
  const packageGroups: PackageGroups = {
    prefix: stringColumn(groupFields.prefix, 'packageGroups.prefix'),
    linked: column(groupFields.linked, 'packageGroups.linked', isBoolean, 'a boolean'),
  }
  inBoundsOrNull('packages.group', packages.group, packageGroups.prefix.length)
  checkPackages(packages)
  checkGroups(packageGroups, packages.group)

  return {
    workspaces,
    packages,
    packageGroups,
    externals: decodeExternals(fields.externals, dir.length, fileCount),
  }
}

/** One row per declaration, each kind once. */
function decodeWorkspaces(value: unknown, fileCount: number): Workspace[] {
  if (!Array.isArray(value)) {
    fail('workspaces is not an array')
  }
  const workspaces = value.map((item, row) => {
    const fields = object(item, `workspaces[${row}]`)
    const kind = fields.kind
    if (typeof kind !== 'string' || !Object.hasOwn(WORKSPACE_KINDS, kind)) {
      fail(`workspaces[${row}].kind is not a workspace kind`)
    }
    const manifest = u32(fields.manifest, `workspaces[${row}].manifest`)
    return { kind: kind as WorkspaceKind, manifest }
  })
  inBounds(
    'workspaces.manifest',
    workspaces.map((workspace) => workspace.manifest),
    fileCount,
  )
  const row = workspaces.findIndex((workspace, at) =>
    workspaces.slice(0, at).some((other) => other.kind === workspace.kind),
  )
  if (row !== -1) {
    fail(`workspaces[${row}] repeats a kind of declaration`)
  }
  return workspaces
}

function checkPackages(packages: Packages): void {
  const { dir } = packages
  for (let row = 1; row < dir.length; row++) {
    if ((dir[row - 1] as number) >= (dir[row] as number)) {
      fail(`packages[${row}] must come after the previous package, by folder`)
    }
  }
  const unnamed = packages.name.indexOf('')
  if (unnamed !== -1) {
    fail(`packages.name[${unnamed}] is empty`)
  }
  for (let row = 0; row < dir.length; row++) {
    const routes = packages.routeCount[row] as number
    if (
      (packages.apiRouteCount[row] as number) > routes ||
      (packages.routes[row] === null && routes > 0)
    ) {
      fail(
        `packages[${row}] must count no more API routes than routes, and routes only in a folder`,
      )
    }
  }
}

function checkGroups(groups: PackageGroups, packageGroups: (number | null)[]): void {
  sameLength('packageGroups.linked', groups.prefix.length, groups.linked)
  const members = groups.prefix.map(() => 0)
  for (const group of packageGroups) {
    if (group !== null) {
      members[group] = (members[group] as number) + 1
    }
  }
  groups.prefix.forEach((prefix, row) => {
    const after = row === 0 || compareCodePoints(groups.prefix[row - 1] as string, prefix) < 0
    if ((members[row] as number) < 2 || prefix === '' || !after) {
      fail(
        `packageGroups[${row}] must have a prefix, after the previous one, and two packages or more`,
      )
    }
  })
}

function decodeExternals(value: unknown, packageCount: number, fileCount: number): Externals {
  const fields = object(value, 'externals')
  const externals: Externals = {
    package: column(fields.package, 'externals.package', isU32OrNull, 'an index or null'),
    manifest: u32Column(fields.manifest, 'externals.manifest'),
    name: stringColumn(fields.name, 'externals.name'),
    dev: column(fields.dev, 'externals.dev', isBoolean, 'a boolean'),
    files: u32Column(fields.files, 'externals.files'),
  }
  const rows = externals.package.length
  sameLength('externals.manifest', rows, externals.manifest)
  sameLength('externals.name', rows, externals.name)
  sameLength('externals.dev', rows, externals.dev)
  sameLength('externals.files', rows, externals.files)
  inBoundsOrNull('externals.package', externals.package, packageCount)
  inBounds('externals.manifest', externals.manifest, fileCount)
  for (let row = 0; row < rows; row++) {
    const name = externals.name[row] as string
    const sorted =
      row === 0 ||
      compareRows(
        externals.package[row - 1] ?? null,
        externals.manifest[row - 1] as number,
        externals.name[row - 1] as string,
        externals.package[row] ?? null,
        externals.manifest[row] as number,
        name,
      ) < 0
    if (name === '' || externals.files[row] === 0 || !sorted) {
      fail(
        `externals[${row}] must have a name and files, after the previous row by package, manifest then name`,
      )
    }
  }
  return externals
}

/** By package, `null` first, then by manifest, then by name, as Rust orders `(Option<u32>, u32, String)`. */
function compareRows(
  aPackage: number | null,
  aManifest: number,
  aName: string,
  bPackage: number | null,
  bManifest: number,
  bName: string,
): number {
  if (aPackage !== bPackage) {
    return aPackage === null ? -1 : bPackage === null ? 1 : aPackage - bPackage
  }
  if (aManifest !== bManifest) {
    return aManifest - bManifest
  }
  return compareCodePoints(aName, bName)
}

/** Rust compares strings byte by byte in UTF-8, which orders them by code point; `<` compares UTF-16 units. */
function compareCodePoints(a: string, b: string): number {
  const left = [...a]
  const right = [...b]
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const difference = (left[i]?.codePointAt(0) ?? 0) - (right[i]?.codePointAt(0) ?? 0)
    if (difference !== 0) {
      return difference
    }
  }
  return left.length - right.length
}
