import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CityEngine } from '../../city/engine/city-engine'
import type { GuidePaths } from '../../city/interaction/city-guide'
import { guideView } from '../../guide/guide-view'
import { isTyping } from '../keys/screen-keys'
import type { ResultIndex } from '../result-index'
import { guideFrame, guidePaths } from './guide-paths'
import { FOLDED, type GuideAction, type GuideState, nextGuide, tourLength } from './guide-state'
import { type TourContext, type TourText, tourContext } from './tour/tour-spans'
import { tourNote, tourText } from './tour/tour-text'

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
  const state = controlled ?? own
  const steps = index.result.tour.steps
  const context = useMemo<TourContext>(() => tourContext(index), [index])

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

  // ← and → go back and on, unless one is typing.
  useEffect(() => {
    if (!touring) {
      return
    }
    const handleKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        isTyping(event.target) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        dispatch({ kind: event.key === 'ArrowLeft' ? 'back' : 'next' })
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [touring, dispatch])

  return {
    state,
    dispatch,
    length: steps.length > 0 ? tourLength(steps.length) : null,
    text,
    shown,
    steps: steps.length,
  }
}
