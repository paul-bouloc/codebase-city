import type { AnalysisStatus } from './Badge'

export const BUILD_STEPS = [
  'queued',
  'downloading',
  'reading',
  'parsing',
  'resolving',
  'mapping',
  'building',
] as const

export type BuildStep = (typeof BUILD_STEPS)[number]

// `reconnecting`: the page lost the live updates. `paused`: waiting for GitHub's rate limit.
export type ProgressOutcome =
  | 'running'
  | 'reconnecting'
  | 'paused'
  | 'done'
  | 'failed'
  | 'cancelled'

export type StepState = 'done' | 'current' | 'upcoming' | 'failed' | 'cancelled'

// `step` is the step in progress, or the one that failed or was cancelled.
export function stepStates(step: BuildStep, outcome: ProgressOutcome): StepState[] {
  const current = BUILD_STEPS.indexOf(step)
  return BUILD_STEPS.map((_, index) => {
    if (outcome === 'done' || index < current) {
      return 'done'
    }
    if (index > current) {
      return 'upcoming'
    }
    if (outcome === 'failed' || outcome === 'cancelled') {
      return outcome
    }
    return 'current'
  })
}

// The five statuses cover everything: waiting on GitHub or a lost connection is still Building.
export function progressStatus(step: BuildStep, outcome: ProgressOutcome): AnalysisStatus {
  if (outcome === 'done' || outcome === 'failed' || outcome === 'cancelled') {
    return outcome
  }
  return step === 'queued' ? 'queued' : 'building'
}
