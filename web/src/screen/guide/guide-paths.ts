import type { GuidePaths } from '../../city/interaction/city-guide'
import type { GuideView } from '../../guide/guide-view'
import type { ResultIndex } from '../result-index'
import { guideUnitLabels } from './guide-unit-labels'

/** What a step shows, by the paths the city knows its files and folders by. */
export function guidePaths(view: GuideView, index: ResultIndex): GuidePaths {
  const files = (rows: readonly number[]) => rows.flatMap((file) => index.filePaths[file] ?? [])
  const folders = (rows: readonly number[]) => rows.flatMap((dir) => index.folderPaths[dir] ?? [])
  const member = view.cycle === null ? undefined : index.result.cycles.members[view.cycle]?.[0]
  const labels = guideUnitLabels(view.units, index.result)
  return {
    files: files(view.files),
    pinned: files(view.pinned),
    labelled: files(view.labelled),
    folders: folders(view.folders),
    units: view.units.map((unit, at) => ({
      folders: folders(unit.folders),
      label: labels[at] ?? null,
    })),
    fade: view.dim,
    cycle: member === undefined ? null : (index.filePaths[member] ?? null),
  }
}
