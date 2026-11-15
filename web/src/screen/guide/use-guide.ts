import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CityEngine } from '../../city/engine/city-engine'
import type { GuidePaths } from '../../city/interaction/city-guide'
import { guideView } from '../../guide/guide-view'
import { isTourKeyTarget, isTourSpaceTarget } from '../keys/screen-keys'
import type { ResultIndex } from '../result-index'
import { guideFrame, guidePaths } from './guide-paths'
import {
  FOLDED,
  type GuideAction,
  type GuideState,
  isAnswer,
  nextGuide,
  tourLength,
} from './guide-state'
import { type Impact, impactOf } from './questions/impact'
import { type Route, routeFinder } from './questions/route'
import { type TourContext, type TourText, tourContext } from './tour/tour-spans'
import { tourNote, tourText } from './tour/tour-text'
import {
  clockDue,
  clockSpent,
  pauseClock,
  resumeClock,
  type StepClock,
  startClock,
  stepSeconds,
} from './tour-clock'

/**
 * Pixels the tour's panel, or an answer's, keeps clear on the left of the city: the camera frames
 * right of them.
 */
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
  /** What depends on the file asked about, while that answer is on show. */
  impact: Impact | null
  /** How a file reaches another, while that answer is on show with both files chosen. */
  route: Route | null
  /**
   * The paths the camera frames for the answer on show: the file, then what depends on it, or
   * the files of a route.
   */
  answerFrame: readonly string[] | null
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
  // What each step says, and how long it stays on show when the tour plays.
  const texts = useMemo(() => steps.map((step) => tourText(context, step)), [steps, context])
  const seconds = useMemo(() => texts.map(stepSeconds), [texts])

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
  const text = state.mode === 'touring' ? (texts[state.step] ?? null) : null
  const { shown, frame } = useMemo(() => {
    if (!step) {
      return { shown: null, frame: null }
    }
    const view = guideView(index.result, step)
    const note = tourNote(context, step)
    return {
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
  const aside = touring || isAnswer(state.mode)
  useEffect(() => {
    engine?.setLeftInset(aside ? TOUR_INSET : 0)
  }, [engine, aside])

  // What depends on the file asked about: kept in colour in the city.
  const impactFile =
    state.mode === 'impact' && state.file !== undefined ? index.fileAt(state.file) : undefined
  const impact = useMemo(
    () => (impactFile === undefined ? null : impactOf(context, impactFile)),
    [context, impactFile],
  )
  // How a file reaches another: its path drawn in the city.
  const routeFrom =
    state.mode === 'route' && state.from !== undefined ? index.fileAt(state.from) : undefined
  const routeTo =
    state.mode === 'route' && state.to !== undefined ? index.fileAt(state.to) : undefined
  const routeChoice = state.mode === 'route' ? (state.path ?? 0) : 0
  // Searched once for its two files; the next shortest path only walks back along it.
  const findRoute = useMemo(
    () =>
      routeFrom === undefined || routeTo === undefined || routeFrom === routeTo
        ? null
        : routeFinder(context, routeFrom, routeTo),
    [context, routeFrom, routeTo],
  )
  const route = useMemo(() => findRoute?.(routeChoice) ?? null, [findRoute, routeChoice])

  // What the answer keeps in colour in the city, and what the camera frames of it, beside the
  // panel: the screen frames it once the selection it reads from the address has moved the
  // camera, if it did. A route not found leaves the city as it is.
  const answer = useMemo(() => {
    const paths = (files: readonly number[]) => files.map((file) => index.filePaths[file] ?? '')
    if (impact) {
      const kept = paths([impact.file, ...impact.dependents])
      return { kept, labelled: kept[0] ?? '' }
    }
    if (route?.kind === 'found') {
      const files = paths(route.files)
      return { kept: files, route: files }
    }
    return null
  }, [index, impact, route])
  useEffect(() => {
    engine?.showAnswer(answer)
  }, [engine, answer])
  const answerFrame = answer?.kept ?? null

  // Each step frames what it shows, beside the panel.
  useEffect(() => {
    if (frame) {
      engine?.frameAll(frame)
    }
  }, [engine, frame])

  // A playing step goes on to the next when its time is up; a pause keeps what was left of it.
  // Another city's step of the same rank starts its own clock.
  const clock = useRef<{ seconds: readonly number[]; step: number; clock: StepClock } | null>(null)
  useEffect(() => {
    if (!touring) {
      clock.current = null
      return
    }
    const now = performance.now()
    // The last step, its time run out, plays again from the start.
    const kept =
      clock.current?.step === state.step &&
      clock.current.seconds === seconds &&
      !clockSpent(clock.current.clock)
        ? clock.current.clock
        : null
    const fresh = kept ?? startClock(seconds[state.step] ?? 0, now)
    const next = state.playing ? resumeClock(fresh, now) : pauseClock(fresh, now)
    clock.current = { seconds, step: state.step, clock: next }
    const due = clockDue(next)
    if (due === null) {
      return
    }
    const timer = window.setTimeout(() => dispatch({ kind: 'advance' }), Math.max(0, due - now))
    return () => window.clearTimeout(timer)
  }, [touring, state.step, state.playing, seconds, dispatch])

  // ← and → go back and on, while touring, from the page, the city or the guide. Space pauses or
  // plays, and starts a tour when none is on; a button with the focus is pressed by it instead.
  useEffect(() => {
    const plain = (event: KeyboardEvent) =>
      !event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.altKey
    // A city without a tour leaves Space alone.
    const space = (event: KeyboardEvent) =>
      event.code === 'Space' &&
      !event.shiftKey &&
      steps.length > 0 &&
      plain(event) &&
      isTourSpaceTarget(event.target)
    const handleKey = (event: KeyboardEvent) => {
      if (space(event)) {
        event.preventDefault()
        if (!event.repeat) {
          dispatch({ kind: 'toggle' })
        }
      } else if (
        touring &&
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
        plain(event) &&
        isTourKeyTarget(event.target)
      ) {
        event.preventDefault()
        dispatch({ kind: event.key === 'ArrowLeft' ? 'back' : 'next' })
      }
    }
    // The pill would be pressed when Space comes up: it starts the tour, it does not just open.
    const handleKeyUp = (event: KeyboardEvent) => {
      if (space(event)) {
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
    impact,
    route,
    answerFrame,
  }
}
