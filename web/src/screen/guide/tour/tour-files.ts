import type { TourStep } from '../../../data/generated/TourStep'
import { exactCount, percent } from '../../../ui/display/count-format'
import { ENTRY_REASONS } from '../../sheets/file/file-sheet'
import {
  chip,
  counted,
  fileSpan,
  files,
  folderSpan,
  islandSpan,
  listed,
  packageSpan,
  type StepText,
  share,
  type TourChip,
  type TourContext,
  type TourSpan,
  targetSpan,
} from './tour-spans'

// What the steps of the tour say about the files of the code: the overview, what it starts from,
// what pulls it together and what it rests on, its layers, loops and complex files, the rest.

type Step<K extends TourStep['kind']> = Extract<TourStep, { kind: K }>

/** What an entry point's reason makes of it: a fact, or a guess. */
const GUESSED = new Set(['conventionalName', 'noImporter'])

export function overviewText(context: TourContext, step: Step<'overview'>): StepText {
  const { result } = context.index
  const islands = result.islands.dir.length
  const text: TourSpan[] = [
    { kind: 'repo', text: `${result.repo.owner}/${result.repo.name}` },
    `: ${files(step.files)} across ${counted(islands, 'island')}.`,
  ]
  const language = step.language === null ? undefined : result.languages[step.language]
  if (language !== undefined && step.lines > 0) {
    const most = `${language} (${percent(step.languageLines / step.lines)})`
    text.push(
      step.languageRead
        ? ` Most of the code is ${most}.`
        : ` Most of the code is ${most}, shown but not analyzed.`,
    )
  }
  if (step.docLanguages > 1) {
    text.push(` The documentation comes in ${exactCount(step.docLanguages)} languages.`)
  }
  const closer: TourChip[] = []
  if (step.biggestIsland !== null && islands > 1) {
    const island = step.biggestIsland
    closer.push(
      ...chip([
        'The biggest island: ',
        islandSpan(context, island),
        ` · ${files(context.islandFiles[island] ?? 0)}`,
      ]),
    )
  }
  if (step.outsideIsland !== null) {
    closer.push(...chip([islandSpan(context, step.outsideIsland), ' · no production code']))
  }
  return { text, closer }
}

export function builtOnText(context: TourContext, step: Step<'builtOn'>): StepText {
  const { externals } = context.index.result
  const items = step.externals.map((row, at): TourSpan[] => {
    const part = share(externals.files[row] ?? 0, step.codeFiles)
    return [
      { kind: 'code', text: externals.name[row] ?? '' },
      at === 0 ? ` (${part} of the code files)` : ` (${part})`,
    ]
  })
  const manifests = [...new Set(step.externals.map((row) => externals.manifest[row] ?? 0))]
  return {
    text: ['The code builds on ', ...listed(items), '.'],
    closer: manifests.flatMap((file) =>
      chip([fileSpan(context, file), manifests.length === 1 ? ' declares them' : ' declares some']),
    ),
  }
}

export function entryPointsText(context: TourContext, step: Step<'entryPoints'>): StepText {
  const { entries } = context.index.result.roles
  const [first, ...others] = step.entries
  if (first === undefined) {
    return { text: [], closer: [] }
  }
  const reason = entries.reasons[first]?.[0] ?? 'noImporter'
  const target = targetSpan(context, entries.file[first] ?? null, entries.dir[first] ?? null)
  const command = entries.command[first] ?? null
  const text: TourSpan[] = GUESSED.has(reason)
    ? ['Likely the entry point: ', target, `. ${ENTRY_REASONS[reason]}`]
    : ['The application starts here: ', target, `. ${ENTRY_REASONS[reason]}`]
  if (command !== null) {
    text.push(' It runs as ', { kind: 'code', text: command }, '.')
  }
  return {
    text,
    closer: others.flatMap((row) =>
      chip([
        'Also an entry point: ',
        targetSpan(context, entries.file[row] ?? null, entries.dir[row] ?? null),
      ]),
    ),
  }
}

export function conductorsText(context: TourContext, step: Step<'conductors'>): StepText {
  const { conductors } = context.index.result.roles
  const at = (row: number) =>
    targetSpan(context, conductors.file[row] ?? null, conductors.dir[row] ?? null)
  const [first, ...others] = step.conductors
  if (first === undefined) {
    return { text: [], closer: [] }
  }
  return {
    text: [
      at(first),
      ` pulls together ${files(conductors.count[first] ?? 0)}, directly or not. It likely assembles the application.`,
    ],
    closer: others.flatMap((row) =>
      chip([at(row), ` · pulls together ${files(conductors.count[row] ?? 0)}`]),
    ),
  }
}

export function foundationsText(context: TourContext, step: Step<'foundations'>): StepText {
  const { foundations } = context.index.result.roles
  const at = (row: number) =>
    targetSpan(context, foundations.file[row] ?? null, foundations.dir[row] ?? null)
  const [first, ...others] = step.foundations
  if (first === undefined) {
    return { text: [], closer: [] }
  }
  const text: TourSpan[] =
    step.island === null ? [] : ['Most foundations sit on ', islandSpan(context, step.island), '. ']
  const dependents = foundations.count[first] ?? 0
  text.push(
    `${exactCount(dependents)} ${dependents === 1 ? 'file depends' : 'files depend'} on `,
    at(first),
    ', directly or not.',
  )
  return {
    text,
    closer: others.flatMap((row) =>
      chip([at(row), ` · ${counted(foundations.count[row] ?? 0, 'dependent')}`]),
    ),
  }
}

export function layersText(context: TourContext, step: Step<'layers'>): StepText {
  const { result } = context.index
  const layers = Math.max(0, ...result.islands.layer.map((layer) => layer ?? 0))
  const largestAt = (layer: number) => {
    let best: number | null = null
    result.islands.layer.forEach((each, island) => {
      const size = context.islandFiles[island] ?? 0
      if (each === layer && (best === null || size > (context.islandFiles[best] ?? 0))) {
        best = island
      }
    })
    return best as number | null
  }
  const [bottom, top] = [largestAt(1), largestAt(layers)]
  const text: TourSpan[] =
    bottom !== null && top !== null && layers > 1
      ? [
          `The islands stand in ${exactCount(layers)} layers, from `,
          islandSpan(context, bottom),
          ' at the bottom to ',
          islandSpan(context, top),
          ' at the top.',
        ]
      : [`The islands stand in ${counted(layers, 'layer')}.`]
  const all = step.down + step.level + step.up
  text.push(
    step.up === 0
      ? ' No import between them goes up.'
      : ` ${share(step.down + step.level, all)} of the imports between them go down or across.`,
  )
  const closer: TourChip[] = []
  if (step.worstLink !== null) {
    const { links } = result
    const [from, to] = [links.from[step.worstLink] ?? 0, links.to[step.worstLink] ?? 0]
    const up = links.productionUpward[step.worstLink] ?? 0
    const [fromSpan, toSpan] = [islandSpan(context, from), islandSpan(context, to)]
    closer.push({
      target: { kind: 'islands', folders: [...fromSpan.folders, ...toSpan.folders] },
      spans: [`${counted(up, 'import')} up from `, fromSpan, ' to ', toSpan],
    })
  }
  return { text, closer }
}

export function examplesText(context: TourContext, step: Step<'examplesAndTests'>): StepText {
  const [first, ...others] = step.folders
  const all = step.examples.reduce((sum, each) => sum + each, 0)
  if (first === undefined) {
    return { text: [], closer: [] }
  }
  const text: TourSpan[] =
    others.length === 0
      ? [`${counted(all, 'example')} in `, folderSpan(context, first), ' import the code.']
      : [
          `${counted(all, 'example')} import the code, ${exactCount(step.examples[0] ?? 0)} of them in `,
          folderSpan(context, first),
          '.',
        ]
  if (step.tests > 0) {
    text.push(` ${counted(step.tests, 'test')} ${step.tests === 1 ? 'runs' : 'run'} them.`)
  }
  return {
    text,
    closer: others.flatMap((folder, at) =>
      chip([folderSpan(context, folder), ` · ${counted(step.examples[at + 1] ?? 0, 'example')}`]),
    ),
  }
}

export function cyclesText(context: TourContext, step: Step<'cycles'>): StepText {
  const { result } = context.index
  const size = result.cycles.members[step.cycle]?.length ?? 0
  const loops = result.cycles.members.length
  const text: TourSpan[] = [
    `${files(size)} in `,
    folderSpan(context, step.dir),
    loops > 1
      ? ` import each other in a loop, the largest of ${exactCount(loops)}.`
      : ' import each other in a loop.',
  ]
  if (step.package !== null && step.inPackage > 1) {
    text.push(
      ` ${exactCount(step.inPackage)} loops lie inside `,
      packageSpan(context, step.package),
      '.',
    )
  }
  if (step.crossing > 0) {
    text.push(
      ` ${counted(step.crossing, 'loop')} ${step.crossing === 1 ? 'crosses' : 'cross'} packages.`,
    )
  }
  return { text, closer: [] }
}

export function complexText(context: TourContext, step: Step<'complexAreas'>): StepText {
  const { complexity } = context.index.result.files
  const [first, ...others] = step.files
  if (first === undefined) {
    return { text: [], closer: [] }
  }
  const most = complexity[first] ?? 0
  return {
    text: [
      'The most complex file is ',
      fileSpan(context, first),
      ` (complexity ${exactCount(most)}, ${share(most, step.complexity)} of the code’s).`,
    ],
    closer: others.flatMap((file) =>
      chip([fileSpan(context, file), ` · complexity ${exactCount(complexity[file] ?? 0)}`]),
    ),
  }
}

export function restText(context: TourContext, step: Step<'rest'>): StepText {
  const text: TourSpan[] = []
  if (step.parkCount > 0 && step.parkTests > 0) {
    text.push(`Tests live in ${counted(step.parkCount, 'park')} (${files(step.parkTests)}).`)
    if (step.tests > step.parkTests) {
      text.push(` ${files(step.tests - step.parkTests)} of tests stand among the code.`)
    }
  } else if (step.tests > 0) {
    text.push(`${files(step.tests)} of tests stand among the code.`)
  }
  if (step.rootConfig > 0) {
    text.push(` Configuration sits at the root (${files(step.rootConfig)}).`)
  } else if (step.config > 0) {
    text.push(` ${counted(step.config, 'configuration file')}.`)
  }
  const more = [
    step.examples > 0 ? counted(step.examples, 'example') : null,
    step.docs > 0 ? `${files(step.docs)} of documentation` : null,
  ].flatMap((each) => (each === null ? [] : [[each]]))
  if (more.length > 0) {
    text.push(' Also ', ...listed(more), '.')
  }
  const [head, ...tail] = text
  return {
    text: typeof head === 'string' ? [head.trimStart(), ...tail] : text,
    closer: step.parks.flatMap((park) => chip([folderSpan(context, park), ' · tests'])),
  }
}
