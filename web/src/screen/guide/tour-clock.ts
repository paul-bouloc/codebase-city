import type { StepText, TourSpan } from './tour/tour-spans'

// How long a step of the tour stays on show when it plays on its own, and the clock that counts
// it down across pauses.

/** A step stays this long at least, in seconds, */
export const MIN_STEP_SECONDS = 12
/** and at most this long, however long its text. */
export const MAX_STEP_SECONDS = 25
/** Seconds to take in what the city shows, before reading; */
const LOOK_SECONDS = 4
/** then words read in a second, at a calm pace. */
const WORDS_PER_SECOND = 3.5

/** Words in a sentence of the tour: a chip or a name counts as one. */
function words(spans: readonly TourSpan[]): number {
  return spans.reduce(
    (sum, span) =>
      sum + (typeof span === 'string' ? span.split(/\s+/).filter((word) => word !== '').length : 1),
    0,
  )
}

/** Seconds a step stays on show: time to look, then to read its text and its chips. */
export function stepSeconds(text: StepText): number {
  const count = words(text.text) + text.closer.reduce((sum, chip) => sum + words(chip.spans), 0)
  const seconds = LOOK_SECONDS + count / WORDS_PER_SECOND
  return Math.round(Math.min(MAX_STEP_SECONDS, Math.max(MIN_STEP_SECONDS, seconds)))
}

/** A step's time: what is left of it, in ms, and when it last went on running, if it runs. */
export interface StepClock {
  left: number
  since: number | null
}

/** A clock for a new step, running from `now`. */
export function startClock(seconds: number, now: number): StepClock {
  return { left: seconds * 1000, since: now }
}

/** The clock stopped at `now`: it keeps what was left. */
export function pauseClock(clock: StepClock, now: number): StepClock {
  if (clock.since === null) {
    return clock
  }
  return { left: Math.max(0, clock.left - (now - clock.since)), since: null }
}

/** The clock running again from `now`, for what it had left. */
export function resumeClock(clock: StepClock, now: number): StepClock {
  return clock.since === null ? { left: clock.left, since: now } : clock
}

/** A stopped clock with nothing left: the step's time ran out, and playing again starts it over. */
export function clockSpent(clock: StepClock): boolean {
  return clock.since === null && clock.left <= 0
}

/** When the step's time is up, or null while the clock is stopped. */
export function clockDue(clock: StepClock): number | null {
  return clock.since === null ? null : clock.since + clock.left
}
