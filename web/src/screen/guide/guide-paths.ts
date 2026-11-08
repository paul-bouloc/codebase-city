import type { GuidePaths } from '../../city/interaction/city-guide'
import type { GuideView } from '../../guide/guide-view'
import type { ResultIndex } from '../result-index'

/** What a step shows, by the paths the city knows its files and folders by. */
export function guidePaths(view: GuideView, index: ResultIndex): GuidePaths {
  const files = (rows: readonly number[]) => rows.flatMap((file) => index.filePaths[file] ?? [])
  const member = view.cycle === null ? undefined : index.result.cycles.members[view.cycle]?.[0]
  return {
    files: files(view.files),
    labelled: files(view.labelled),
    folders: view.folders.flatMap((dir) => index.folderPaths[dir] ?? []),
    fade: view.dim,
    cycle: member === undefined ? null : (index.filePaths[member] ?? null),
  }
}
