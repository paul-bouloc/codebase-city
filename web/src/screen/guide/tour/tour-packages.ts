import type { TourStep } from '../../../data/generated/TourStep'
import { type GuideUnit, guideUnits } from '../../../guide/guide-units'
import { exactCount } from '../../../ui/display/count-format'
import {
  chip,
  counted,
  fileSpan,
  files,
  folderSpan,
  frameworkName,
  listed,
  packageSpan,
  type StepText,
  type TourChip,
  type TourContext,
  type TourSpan,
  unitSpan,
} from './tour-spans'

// What the steps of a monorepo's tour say about its packages: its apps, its libraries, what
// links them, who uses them, and what the main one holds.

type Step<K extends TourStep['kind']> = Extract<TourStep, { kind: K }>

/** Units named in a sentence; the next ones get a chip each. */
const IN_TEXT = 3
/** Chips under LOOK CLOSER, at most. */
const CHIPS = 3

/** "web (Next.js, 7,878 files)", "billing ×3 (3 apps, 2,516)": the noun on the first one only. */
function unitItem(context: TourContext, unit: GuideUnit, first: boolean): TourSpan[] {
  const count = first ? files(unit.codeFiles) : exactCount(unit.codeFiles)
  const framework = frameworkName(unit.framework)
  const facts =
    unit.kind === 'group'
      ? `${unit.packages.length} apps, ${count}`
      : framework === null
        ? count
        : `${framework}, ${count}`
  return [unitSpan(context, unit), ` (${facts})`]
}

/** A chip for a unit past the sentence: "collect · FastAPI · 670 files". */
function unitChip(context: TourContext, unit: GuideUnit): TourChip[] {
  const framework = frameworkName(unit.framework)
  const facts = [
    unit.kind === 'group' ? `${unit.packages.length} apps` : framework,
    files(unit.codeFiles),
  ].filter((each) => each !== null)
  return chip([unitSpan(context, unit), ` · ${facts.join(' · ')}`])
}

export function applicationsText(context: TourContext, step: Step<'applications'>): StepText {
  const { result } = context.index
  const units = guideUnits(result, step)
  const named = units.slice(0, IN_TEXT)
  const text: TourSpan[] = [`${files(step.appFiles)} are apps.`]
  if (named.length > 0) {
    text.push(
      named.length === 1 ? ' The main one: ' : ' The main ones: ',
      ...listed(named.map((unit, at) => unitItem(context, unit, at === 0))),
      '.',
    )
  }
  const closer = units.slice(IN_TEXT).flatMap((unit) => unitChip(context, unit))
  const others = result.tour.steps.find((each) => each.kind === 'otherApps')
  if (others?.kind === 'otherApps' && closer.length < CHIPS) {
    closer.push({
      target: { kind: 'next' },
      spans: [`${counted(others.apps.length, 'smaller app')} · next step`],
    })
  }
  return { text, closer: closer.slice(0, CHIPS) }
}

export function otherAppsText(context: TourContext, step: Step<'otherApps'>): StepText {
  const { result } = context.index
  const units = guideUnits(result, step)
  const all = step.apps.reduce((sum, row) => sum + (result.packages.codeFiles[row] ?? 0), 0)
  const lead = result.tour.steps.some((each) => each.kind === 'applications')
  const noun = lead ? 'smaller app' : 'app'
  const named = units.slice(0, 2)
  // Units are the apps the city shows: one standing on every island has none
  const count = step.apps.length
  const [only] = units
  const text: TourSpan[] =
    count === 1 && only
      ? [`One ${noun}: `, ...unitItem(context, only, true), '.']
      : [`${counted(count, noun)} ${count === 1 ? 'holds' : 'hold'} ${files(all)}.`]
  if (count > 1 && named.length > 0) {
    text.push(
      ' The biggest: ',
      ...listed(named.map((unit, at) => unitItem(context, unit, at === 0))),
      '.',
    )
  }
  return {
    text,
    closer: units
      .slice(named.length, named.length + CHIPS)
      .flatMap((unit) => unitChip(context, unit)),
  }
}

export function librariesText(context: TourContext, step: Step<'libraries'>): StepText {
  const { result } = context.index
  const libraries = result.packages.kind.filter((kind) => kind === 'library').length
  const by = (at: number) => ` by ${counted(step.importers[at] ?? 0, 'package')}`
  const most = step.mostImported.slice(0, 2)
  const text: TourSpan[] = [`${counted(libraries, 'library', 'libraries')}. `]
  if (most.length > 0) {
    text.push(
      'Most imported: ',
      ...listed(most.map((row, at) => [packageSpan(context, row), by(at)])),
      '. ',
    )
  }
  text.push(
    'The biggest is ',
    packageSpan(context, step.largest),
    `: ${files(result.packages.codeFiles[step.largest] ?? 0)}.`,
  )
  return {
    text,
    closer: step.mostImported
      .slice(most.length)
      .flatMap((row, at) => chip([packageSpan(context, row), ` ·${by(at + most.length)}`])),
  }
}

export function appLinksText(context: TourContext, step: Step<'appLinks'>): StepText {
  const text: TourSpan[] = [
    step.appImports === 0
      ? 'The apps don’t import each other.'
      : `${counted(step.appImports, 'import')} ${step.appImports === 1 ? 'goes' : 'go'} from one app to another.`,
  ]
  const [first, ...others] = step.shared
  if (first) {
    const importing = first.files.reduce((sum, each) => sum + each, 0)
    const typeOnly = first.typeOnly.reduce((sum, each) => sum + each, 0)
    text.push(
      ' ',
      ...listed(first.apps.map((row) => [packageSpan(context, row)])),
      ' share ',
      packageSpan(context, first.library),
      `: ${files(importing)} import it`,
      typeOnly > 0 ? `, ${exactCount(typeOnly)} for types only.` : '.',
    )
  }
  return {
    text,
    closer: others.flatMap((shared) =>
      chip([
        packageSpan(context, shared.library),
        ` · shared by ${counted(shared.apps.length, 'app')}`,
      ]),
    ),
  }
}

export function consumersText(context: TourContext, step: Step<'consumers'>): StepText {
  const [first, ...others] = step.folders
  if (!first) {
    return { text: [], closer: [] }
  }
  return {
    text: [
      'Examples and tests outside the packages import them: ',
      folderSpan(context, first.dir),
      ` (${counted(first.folders, 'folder')}, ${counted(first.imports, 'import')}). The most imported is `,
      packageSpan(context, step.package),
      '.',
    ],
    closer: others.flatMap((folder) =>
      chip([folderSpan(context, folder.dir), ` · ${counted(folder.imports, 'import')}`]),
    ),
  }
}

export function insideText(context: TourContext, step: Step<'insidePackage'>): StepText {
  const { packages } = context.index.result
  const text: TourSpan[] = [
    'Inside ',
    packageSpan(context, step.package),
    ': ',
    ...listed(
      step.dirs.map((dir, at) => [
        folderSpan(context, dir),
        ` (${at === 0 ? files(step.files[at] ?? 0) : exactCount(step.files[at] ?? 0)})`,
      ]),
    ),
    '.',
  ]
  const closer: TourChip[] = []
  const entry = packages.entry[step.package] ?? null
  if (entry !== null) {
    closer.push(...chip(['It starts from ', fileSpan(context, entry)]))
  }
  const routes = packages.routes[step.package] ?? null
  if (routes !== null) {
    const count = packages.routeCount[step.package] ?? 0
    closer.push(...chip([folderSpan(context, routes), ` · ${counted(count, 'route')}`]))
  }
  return { text, closer }
}
