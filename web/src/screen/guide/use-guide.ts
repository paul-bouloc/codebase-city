import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CityEngine } from '../../city/engine/city-engine'
import type { GuidePaths } from '../../city/interaction/city-guide'
import { guideView } from '../../guide/guide-view'
import { isTourKeyTarget } from '../keys/screen-keys'
import type { ResultIndex } from '../result-index'
import { guideFrame, guidePaths } from './guide-paths'
import { FOLDED, type GuideAction, type GuideState, nextGuide, tourLength } from './guide-state'
import { type TourContext, type TourText, tourContext } from './tour/tour-spans'
import { tourNote, tourText } from './tour/tour-text'
import {
  clockDue,
  pauseClock,
  resumeClock,
  type StepClock,
  startClock,
  stepSeconds,
} from './tour-clock'

/** Pixels the tour's panel keeps clear on the left of the city: the camera frames right of them. */
const TOUR_INSET = 520

/** A step of the guide's tour on show: what it puts forward, and its labels' notes by path. */
export interface ScreenGuide {
  paths: GuidePaths
  notes: ReadonlyMap<string, string>
}

export interface Guide {
  state: GuideState
  dispatch: (action: GuideAction) => void
  /** "9 steps · about 2 min", or null for a city without a tour. */
  length: string | null
  /** The step on show, while touring. */
  text: TourText | null
  /** What the city shows of it. */
  shown: ScreenGuide | null
  steps: number
}

/**
 * The guide of a city: folded, open, or touring, with what each step says and shows. The state
 * is the caller's when it passes one (development), the guide's own otherwise.
 */
export function useGuide(
  engine: CityEngine | null,
  index: ResultIndex,
  controlled?: GuideState,
  onChange?: (state: GuideState) => void,
): Guide {
  const [own, setOwn] = useState<GuideState>(FOLDED)
  const steps = index.result.tour.steps
  // A step the tour does not have (another city) folds the guide.
  const kept = controlled ?? own
  const state = kept.mode === 'touring' && kept.step >= steps.length ? FOLDED : kept
  const context = useMemo<TourContext>(() => tourContext(index), [index])
  // How long each step stays on show when the tour plays.
  const seconds = useMemo(
    () => steps.map((step) => stepSeconds(tourText(context, step))),
    [steps, context],
  )

  // Actions in a row, faster than renders (a key held down), each start from the one before.
  const latest = useRef(state)
  latest.current = state
  const dispatch = useCallback(
    (action: GuideAction) => {
      const next = nextGuide(latest.current, action, steps.length)
      if (next !== latest.current) {
        latest.current = next
        setOwn(next)
        onChange?.(next)
      }
    },
    [steps.length, onChange],
  )

  const step = state.mode === 'touring' ? (steps[state.step] ?? null) : null
  const { text, shown, frame } = useMemo(() => {
    if (!step) {
      return { text: null, shown: null, frame: null }
    }
    const view = guideView(index.result, step)
    const note = tourNote(context, step)
    return {
      text: tourText(context, step),
      shown: {
        paths: guidePaths(view, index),
        notes: new Map(
          view.labelled.flatMap((file) => index.filePaths[file] ?? []).map((path) => [path, note]),
        ),
      },
      frame: guideFrame(view, index),
    }
  }, [step, index, context])

  const touring = state.mode === 'touring'
  useEffect(() => {
    engine?.setLeftInset(touring ? TOUR_INSET : 0)
  }, [engine, touring])

  // Each step frames what it shows, beside the panel.
  useEffect(() => {
    if (frame) {
      engine?.frameAll(frame)
    }
  }, [engine, frame])

  // A playing step goes on to the next when its time is up; a pause keeps what was left of it.
  const clock = useRef<{ step: number; clock: StepClock } | null>(null)
  useEffect(() => {
    if (!touring) {
      clock.current = null
      return
    }
    const now = performance.now()
    const kept = clock.current?.step === state.step ? clock.current.clock : null
    const fresh = kept ?? startClock(seconds[state.step] ?? 0, now)
    const next = state.playing ? resumeClock(fresh, now) : pauseClock(fresh, now)
    clock.current = { step: state.step, clock: next }
    const due = clockDue(next)
    if (due === null) {
      return
    }
    const timer = window.setTimeout(() => dispatch({ kind: 'advance' }), Math.max(0, due - now))
    return () => window.clearTimeout(timer)
  }, [touring, state.step, state.playing, seconds, dispatch])

  // ← and → go back and on, while touring; Space pauses or plays, and starts a tour when none is
  // on: from the page, the city or the guide, whose buttons it does not press.
  useEffect(() => {
    const ours = (event: KeyboardEvent) =>
      !event.defaultPrevented &&
      isTourKeyTarget(event.target) &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    const handleKey = (event: KeyboardEvent) => {
      if (!ours(event)) {
        return
      }
      if (event.code === 'Space' && !event.shiftKey) {
        event.preventDefault()
        if (!event.repeat && steps.length > 0) {
          dispatch({ kind: 'toggle' })
        }
      } else if (touring && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault()
        dispatch({ kind: event.key === 'ArrowLeft' ? 'back' : 'next' })
      }
    }
    // A button with the focus is pressed when Space comes up.
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !event.shiftKey && ours(event)) {
        event.preventDefault()
      }
    }
    window.addEventListener('keydown', handleKey)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKey)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [touring, dispatch, steps.length])

  return {
    state,
    dispatch,
    length: seconds.length > 0 ? tourLength(seconds) : null,
    text,
    shown,
    steps: steps.length,
  }
}
