// What the guide shows: folded into its pill, open on its questions, a step of the tour, which
// plays on its own or waits, or the answer to a question.

export type GuideMode = 'folded' | 'open' | 'touring' | 'impact'

export interface GuideState {
  mode: GuideMode
  /** The step of the tour on show, while touring; a row of `tour.steps`. */
  step: number
  /** The tour goes on to the next step on its own, while touring. */
  playing: boolean
  /** The file whose impact is on show, by path; none while its field is empty. */
  file?: string
}

export const FOLDED: GuideState = { mode: 'folded', step: 0, playing: false }

export type GuideAction =
  | { kind: 'open' }
  | { kind: 'fold' }
  /** The tour from its first step, playing. */
  | { kind: 'start' }
  | { kind: 'next' }
  | { kind: 'back' }
  | { kind: 'pause' }
  /** Space, or the Play/Pause button: pauses or plays the tour, or starts it when none is on. */
  | { kind: 'toggle' }
  /** A step's time is up: the next one, or a pause on the last. */
  | { kind: 'advance' }
  /** What depends on this file, or on none yet: its field is empty. */
  | { kind: 'impact'; file: string | null }
  /** From an answer back to the questions. */
  | { kind: 'questions' }

/** The guide after an action, the tour having `steps` steps; past the last one, it folds. */
export function nextGuide(state: GuideState, action: GuideAction, steps: number): GuideState {
  const touring = state.mode === 'touring'
  switch (action.kind) {
    case 'open':
      return { mode: 'open', step: 0, playing: false }
    case 'fold':
      return FOLDED
    case 'start':
      return steps > 0 ? { mode: 'touring', step: 0, playing: true } : state
    case 'next':
      if (!touring) {
        return state
      }
      return state.step + 1 < steps ? { ...state, step: state.step + 1 } : FOLDED
    case 'back':
      return touring && state.step > 0 ? { ...state, step: state.step - 1 } : state
    case 'pause':
      return touring && state.playing ? { ...state, playing: false } : state
    case 'toggle':
      return touring
        ? { ...state, playing: !state.playing }
        : nextGuide(state, { kind: 'start' }, steps)
    case 'advance':
      if (!touring || !state.playing) {
        return state
      }
      // The last step stays on show: the reader ends the tour.
      return state.step + 1 < steps
        ? { ...state, step: state.step + 1 }
        : { ...state, playing: false }
    case 'impact':
      return action.file === null
        ? { mode: 'impact', step: 0, playing: false }
        : { mode: 'impact', step: 0, playing: false, file: action.file }
    case 'questions':
      return state.mode === 'impact' ? { mode: 'open', step: 0, playing: false } : state
  }
}

/** "9 steps · about 2 min", from each step's seconds: rounded to the minute, never under one. */
export function tourLength(seconds: readonly number[]): string {
  const steps = seconds.length
  const total = seconds.reduce((sum, each) => sum + each, 0)
  const minutes = Math.max(1, Math.round(total / 60))
  return `${steps} ${steps === 1 ? 'step' : 'steps'} · about ${minutes} min`
}
