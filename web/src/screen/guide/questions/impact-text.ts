import { exactCount, percent } from '../../../ui/display/count-format'
import type { Impact } from './impact'

// What the answer to "What depends on this file?" says, from the impact measured.

export interface ImpactText {
  /** "6,213 files depend on", then the file's name; null when none does. */
  lead: string | null
  /** "No file depends on nls.ts.", when none does. */
  none: string | null
  /** "41% of the repository · 1,880 directly, 4,333 through other files · 58 tests." */
  detail: string | null
}

const files = (count: number) => `${exactCount(count)} ${count === 1 ? 'file' : 'files'}`

export function impactText(impact: Impact, name: string): ImpactText {
  const total = impact.dependents.length
  if (total === 0) {
    return { lead: null, none: `No file depends on ${name}.`, detail: null }
  }
  const share = percent(total / Math.max(1, impact.files))
  const indirect = total - impact.direct
  const tests =
    impact.tests > 0
      ? ` · ${exactCount(impact.tests)} ${impact.tests === 1 ? 'test' : 'tests'}`
      : ''
  return {
    lead: `${files(total)} ${total === 1 ? 'depends' : 'depend'} on`,
    none: null,
    detail: `${share} of the repository · ${exactCount(impact.direct)} directly, ${exactCount(indirect)} through other files${tests}.`,
  }
}

/** "12 other islands": the last row of the islands, past those shown. */
export function otherIslandsText(islands: number): string {
  return `${exactCount(islands)} other ${islands === 1 ? 'island' : 'islands'}`
}
