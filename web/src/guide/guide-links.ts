import type { TourStep } from '../data/generated/TourStep'
import type { GuideUnit } from './guide-units'

// The links a step of a monorepo's tour shows between its units: from each unit of apps to each
// library it shares with apps of other units, with the files that import it.

export interface GuideLink {
  /** The importing unit and the library's, as indexes of the step's units. */
  from: number
  to: number
  /** Production files of the unit that import the library. */
  files: number
  /** Of them, files that import only its types. */
  typeOnly: number
}

/**
 * The links of a step, library by library in the step's order, the unit with the most files
 * first; one for each unit, whatever number of its apps import the library. A unit the step
 * shows nothing of has none.
 */
export function guideLinks(step: TourStep, units: readonly GuideUnit[]): GuideLink[] {
  if (step.kind !== 'appLinks') {
    return []
  }
  const unitOf = (row: number) => units.findIndex((unit) => unit.packages.includes(row))
  return step.shared.flatMap((shared) => {
    const to = unitOf(shared.library)
    if (to < 0) {
      return []
    }
    const links = new Map<number, GuideLink>()
    shared.apps.forEach((app, at) => {
      const from = unitOf(app)
      if (from < 0 || from === to) {
        return
      }
      const link = links.get(from) ?? { from, to, files: 0, typeOnly: 0 }
      link.files += shared.files[at] ?? 0
      link.typeOnly += shared.typeOnly[at] ?? 0
      links.set(from, link)
    })
    return [...links.values()].sort((a, b) => b.files - a.files || a.from - b.from)
  })
}
