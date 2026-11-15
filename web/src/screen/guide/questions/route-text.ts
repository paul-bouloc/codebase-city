import { exactCount } from '../../../ui/display/count-format'
import { COUNTED_PATHS, type NoRouteReason } from './route'

// What the answer to "How does A reach B?" says, from the route measured.

const counted = (count: number, one: string, many: string) =>
  `${exactCount(count)} ${count === 1 ? one : many}`

/** "4 steps", " through 5 files", then " · 1 of 3 shortest paths" when there is more than one. */
export function routeSummary(
  files: number,
  paths: number,
  choice: number,
): { steps: string; through: string; which: string | null } {
  const total = paths > COUNTED_PATHS ? `${COUNTED_PATHS}+` : exactCount(paths)
  return {
    steps: counted(files - 1, 'step', 'steps'),
    through: ` through ${counted(files, 'file', 'files')}`,
    which: paths > 1 ? ` · ${exactCount(choice + 1)} of ${total} shortest paths` : null,
  }
}

/**
 * Why `from` does not reach `to`, then the other way round: "a.ts imports no file of the
 * repository. The other way round, b.ts reaches a.ts in 3 steps."
 */
export function noRouteText(
  reason: NoRouteReason,
  from: string,
  to: string,
  back: number | null,
): string {
  const why = (() => {
    switch (reason.kind) {
      case 'imports-nothing':
        return `${from} imports no file of the repository.`
      case 'imported-by-nothing':
        return `Nothing imports ${to}.`
      case 'below':
        return `${from} is in ${reason.from.island} (layer ${reason.from.layer}), below ${to} in ${reason.to.island} (layer ${reason.to.layer}).`
      // It imports a file at least, or the first reason would hold.
      case 'reaches':
        return `${from} reaches ${counted(reason.files, 'file', 'files')}; ${to} isn’t one of them.`
    }
  })()
  const other =
    back === null
      ? 'Neither depends on the other.'
      : `The other way round, ${to} reaches ${from} in ${counted(back, 'step', 'steps')}.`
  return `${why} ${other}`
}

/** "Path from terminal.ts to async.ts": the list of the path, read out. */
export function routeLabel(from: string, to: string): string {
  return `Path from ${from} to ${to}`
}
