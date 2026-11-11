// Reading the fields of a step of the tour, with the checks of crates/model/src/validate/tour.rs.

import type { AnalysisResult } from '../generated/AnalysisResult'
import { fail, inBounds, isU32List, u32 } from './checks'

export const MAX_ROWS = 3

/** The tables a tour points into, already decoded. */
export type Tables = Pick<
  AnalysisResult,
  | 'dirs'
  | 'files'
  | 'languages'
  | 'roles'
  | 'islands'
  | 'links'
  | 'cycles'
  | 'packages'
  | 'packageGroups'
>

export interface StepFields {
  count: (name: string) => number
  /** A list of counts, which may repeat. */
  counts: (name: string) => number[]
  index: (name: string, length: number) => number
  optional: (name: string, length: number) => number | null
  /** A list of indexes from `min` to `max` rows, each once, in bounds. */
  list: (name: string, length: number, min?: number, max?: number) => number[]
  indexes: (value: unknown, name: string, length: number, min: number, max: number) => number[]
  holds: (holds: boolean) => void
}

/** The checks every kind of step reads its fields with. */
export function stepFields(fields: Record<string, unknown>, path: string, row: number): StepFields {
  const count = (name: string) => u32(fields[name], `${path}.${name}`)
  const index = (name: string, length: number) => {
    const at = count(name)
    inBounds(`tour.${name}`, [at], length)
    return at
  }
  const indexes = (value: unknown, name: string, length: number, min: number, max: number) => {
    if (!isU32List(value)) {
      fail(`${path}.${name} is not a list of indexes`)
    }
    if (value.length < min || value.length > max || new Set(value).size !== value.length) {
      fail(`a list of tour.steps[${row}] must hold as many rows as its step allows, each once`)
    }
    inBounds(`tour.${name}`, value, length)
    return value
  }
  const counts = (name: string) => {
    const value = fields[name]
    return isU32List(value) ? value : fail(`${path}.${name} is not a list of counts`)
  }
  return {
    count,
    counts,
    index,
    optional: (name, length) => (fields[name] === null ? null : index(name, length)),
    list: (name, length, min = 1, max = MAX_ROWS) => indexes(fields[name], name, length, min, max),
    indexes,
    holds: (holds) => {
      if (!holds) {
        fail(`the counts of tour.steps[${row}] do not add up`)
      }
    },
  }
}
