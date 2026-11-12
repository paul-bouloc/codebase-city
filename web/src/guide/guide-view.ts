import type { AnalysisResult } from '../data/generated/AnalysisResult'
import type { Ranked } from '../data/generated/Ranked'
import type { TourStep } from '../data/generated/TourStep'
import { type GuideUnit, guideUnits, unitFolders } from './guide-units'

// What the city shows of a step of the tour: the files it puts forward, the folders it rings,
// what fades, and the cycle it draws. Rows of the result, not paths: the screen turns them into
// what the city knows.

/** What fades: nothing, all but what the step shows, or all but the folders it rings. */
export type GuideDim = 'none' | 'all' | 'others'

export interface GuideView {
  /** Files in the Guide state. */
  files: number[]
  /** Of those, the ones with a pin: one for each file or package the step names. */
  pinned: number[]
  /** Of those, the ones that carry a label over their pin. */
  labelled: number[]
  /** Folders ringed in Jade: islands or parcels. */
  folders: number[]
  /** The packages shown, unit by unit, the largest first. */
  units: GuideUnit[]
  dim: GuideDim
  /** A row of `cycles`, drawn as a loop. */
  cycle: number | null
}

const NOTHING: GuideView = {
  files: [],
  pinned: [],
  labelled: [],
  folders: [],
  units: [],
  dim: 'none',
  cycle: null,
}

export function guideView(result: AnalysisResult, step: TourStep): GuideView {
  switch (step.kind) {
    case 'overview':
    case 'layers':
      return NOTHING
    case 'builtOn': {
      // The dependencies are outside the city: the manifests that declare them are in it
      const manifests = [
        ...new Set(step.externals.flatMap((row) => result.externals.manifest[row] ?? [])),
      ]
      return forward(result, manifests, (file) => [file, null])
    }
    case 'entryPoints': {
      const { file, dir } = result.roles.entries
      return forward(result, step.entries, (row) => [file[row] ?? null, dir[row] ?? null])
    }
    case 'conductors':
      return forward(result, step.conductors, target(result.roles.conductors))
    case 'foundations': {
      const view = forward(result, step.foundations, target(result.roles.foundations))
      const island = step.island === null ? undefined : result.islands.dir[step.island]
      return island === undefined ? view : { ...view, folders: [island], dim: 'others' }
    }
    case 'applications':
    case 'otherApps':
    case 'libraries':
    case 'appLinks': {
      const units = guideUnits(result, step)
      return { ...ringed(unitFolders(units)), units }
    }
    case 'examplesAndTests':
      return ringed(step.folders)
    case 'consumers':
      return ringed(step.folders.map((folder) => folder.dir))
    case 'insidePackage':
      return ringed(step.dirs)
    case 'cycles':
      return { ...NOTHING, dim: 'all', cycle: step.cycle }
    case 'complexAreas':
      return forward(result, step.files, (file) => [file, null])
    case 'rest':
      return { ...NOTHING, folders: step.parks }
  }
}

/** These folders ringed, the rest faded; nothing fades without them. */
function ringed(folders: number[]): GuideView {
  const shown = [...new Set(folders)]
  return { ...NOTHING, folders: shown, dim: shown.length > 0 ? 'others' : 'none' }
}

type Target = [file: number | null, dir: number | null]

function target(ranked: Ranked): (row: number) => Target {
  return (row) => [ranked.file[row] ?? null, ranked.dir[row] ?? null]
}

/**
 * The files of these rows in the Guide state, the rest faded, each pinned, the first one
 * labelled. A Go package puts forward its production files, and its largest stands for it.
 */
function forward(result: AnalysisResult, rows: number[], at: (row: number) => Target): GuideView {
  const files: number[] = []
  const pinned: number[] = []
  const labelled: number[] = []
  rows.forEach((row, place) => {
    const [file, dir] = at(row)
    const shown = file !== null ? [file] : dir !== null ? packageFiles(result, dir) : []
    files.push(...shown)
    const largest = shown.reduce<number | null>(
      (best, each) =>
        best === null || (result.files.lines[each] ?? 0) > (result.files.lines[best] ?? 0)
          ? each
          : best,
      null,
    )
    if (largest !== null) {
      pinned.push(largest)
      if (place === 0) {
        labelled.push(largest)
      }
    }
  })
  return { ...NOTHING, files: [...new Set(files)], pinned, labelled, dim: 'all' }
}

/** The production files right in a package's folder. */
function packageFiles(result: AnalysisResult, dir: number): number[] {
  const { files } = result
  const found: number[] = []
  files.dir.forEach((at, file) => {
    if (at === dir && files.scope[file] === 'source' && !files.generated[file]) {
      found.push(file)
    }
  })
  return found
}
