// What the guide shows: folded into its pill, open on its questions, or a step of the tour.

export type GuideMode = 'folded' | 'open' | 'touring'

export interface GuideState {
  mode: GuideMode
  /** The step of the tour on show, while touring; a row of `tour.steps`. */
  step: number
}

export const FOLDED: GuideState = { mode: 'folded', step: 0 }

export type GuideAction =
  | { kind: 'open' }
  | { kind: 'fold' }
  | { kind: 'start' }
  | { kind: 'next' }
  | { kind: 'back' }

/** Seconds each step counts for in the tour's length. */
export const STEP_SECONDS = 12

/** The guide after an action, the tour having `steps` steps; past the last one, it folds. */
export function nextGuide(state: GuideState, action: GuideAction, steps: number): GuideState {
  switch (action.kind) {
    case 'open':
      return { mode: 'open', step: 0 }
    case 'fold':
      return FOLDED
    case 'start':
      return steps > 0 ? { mode: 'touring', step: 0 } : state
    case 'next':
      if (state.mode !== 'touring') {
        return state
      }
      return state.step + 1 < steps ? { mode: 'touring', step: state.step + 1 } : FOLDED
    case 'back':
      return state.mode === 'touring' && state.step > 0
        ? { mode: 'touring', step: state.step - 1 }
        : state
  }
}

/** "9 steps · about 2 min": each step its time, rounded to the minute, never under one. */
export function tourLength(steps: number): string {
  const minutes = Math.max(1, Math.round((steps * STEP_SECONDS) / 60))
  return `${steps} ${steps === 1 ? 'step' : 'steps'} · about ${minutes} min`
}
