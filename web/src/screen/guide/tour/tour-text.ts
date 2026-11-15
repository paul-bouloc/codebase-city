import type { TourStep } from '../../../data/generated/TourStep'
import { exactCount } from '../../../ui/display/count-format'
import {
  builtOnText,
  complexText,
  conductorsText,
  cyclesText,
  entryPointsText,
  examplesText,
  foundationsText,
  layersText,
  overviewText,
  restText,
} from './tour-files'
import {
  appLinksText,
  applicationsText,
  consumersText,
  insideText,
  leadByApps,
  librariesText,
  otherAppsText,
} from './tour-packages'
import { counted, type StepText, type TourContext, type TourText } from './tour-spans'

// What each step of the tour says: its title, its sentences, its chips, and the note on the mark
// over the roof it puts forward.

const TITLES: Record<TourStep['kind'], string> = {
  overview: 'Overview',
  builtOn: 'Built on',
  entryPoints: 'Entry points',
  conductors: 'Conductors',
  foundations: 'Foundations',
  applications: 'Applications',
  otherApps: 'Other apps',
  libraries: 'Libraries',
  appLinks: 'What links the apps',
  consumers: 'Who uses the packages',
  insidePackage: 'Inside the main app',
  layers: 'Layers',
  examplesAndTests: 'Examples and tests',
  cycles: 'Cycles',
  complexAreas: 'Complex areas',
  rest: 'The rest',
}

export function tourTitle(context: TourContext, step: TourStep): string {
  if (step.kind === 'otherApps' && !leadByApps(context)) {
    return 'Apps'
  }
  if (step.kind === 'insidePackage' && context.index.result.packages.kind[step.package] !== 'app') {
    return 'Inside the main library'
  }
  return TITLES[step.kind]
}

export function tourText(context: TourContext, step: TourStep): TourText {
  return { title: tourTitle(context, step), ...stepText(context, step) }
}

function stepText(context: TourContext, step: TourStep): StepText {
  switch (step.kind) {
    case 'overview':
      return overviewText(context, step)
    case 'builtOn':
      return builtOnText(context, step)
    case 'entryPoints':
      return entryPointsText(context, step)
    case 'conductors':
      return conductorsText(context, step)
    case 'foundations':
      return foundationsText(context, step)
    case 'applications':
      return applicationsText(context, step)
    case 'otherApps':
      return otherAppsText(context, step)
    case 'libraries':
      return librariesText(context, step)
    case 'appLinks':
      return appLinksText(context, step)
    case 'consumers':
      return consumersText(context, step)
    case 'insidePackage':
      return insideText(context, step)
    case 'layers':
      return layersText(context, step)
    case 'examplesAndTests':
      return examplesText(context, step)
    case 'cycles':
      return cyclesText(context, step)
    case 'complexAreas':
      return complexText(context, step)
    case 'rest':
      return restText(context, step)
  }
}

/**
 * What the mark over the first roof a step puts forward says after the file's name: "entry
 * point", "6,213 dependents"; nothing for a step that marks no roof.
 */
export function tourNote(context: TourContext, step: TourStep): string {
  const { result } = context.index
  switch (step.kind) {
    case 'builtOn':
      return 'declares what the code builds on'
    case 'entryPoints':
      return 'entry point'
    case 'conductors':
      return `pulls together ${counted(result.roles.conductors.count[step.conductors[0] ?? 0] ?? 0, 'file')}`
    case 'foundations':
      return counted(result.roles.foundations.count[step.foundations[0] ?? 0] ?? 0, 'dependent')
    case 'complexAreas':
      return `complexity ${exactCount(result.files.complexity[step.files[0] ?? 0] ?? 0)}`
    default:
      return ''
  }
}
