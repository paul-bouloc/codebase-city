import { useEffect, useRef } from 'react'
import type { SearchIndex } from '../search/search-index'
import { GuideCard, GuidePill, type GuideQuestion } from './GuideCard'
import type { GuideAction, GuideMode, GuideState } from './guide-state'
import { CYCLES_QUESTION, CyclesPanel } from './questions/CyclesPanel'
import type { CycleList } from './questions/cycles'
import { IMPACT_QUESTION, ImpactPanel } from './questions/ImpactPanel'
import type { Impact } from './questions/impact'
import { ROUTE_QUESTION, RoutePanel } from './questions/RoutePanel'
import type { Route } from './questions/route'
import { TourPanel } from './TourPanel'
import type { TourTarget, TourText } from './tour/tour-spans'

interface GuideDockProps {
  state: GuideState
  dispatch: (action: GuideAction) => void
  length: string | null
  text: TourText | null
  steps: number
  repoName: string
  onChip: (target: TourTarget) => void
  /** What depends on the file asked about, while that answer is on show. */
  impact: Impact | null
  searchIndex: SearchIndex
  /** "What depends on this file?" asked from the questions. */
  onAskImpact: () => void
  /** A file chosen, or the field emptied, in the impact answer. */
  onImpactFile: (path: string | null) => void
  /** How a file reaches another, once both are chosen. */
  route: Route | null
  /** Every file's path, by file. */
  filePaths: readonly string[]
  /** "How does A reach B?" asked from the questions. */
  onAskRoute: () => void
  /** A file of a route chosen, or its field emptied. */
  onRouteFiles: (from: string | null, to: string | null) => void
  /** A stop of the route chosen. */
  onRouteStop: (path: string) => void
  /** Grows each time the route is asked from a file: the focus goes to the field it goes to. */
  routeAsked: number
  /** The city's cycles, the biggest first. */
  cycles: CycleList
  /** "Where are the cycles?" asked from the questions. */
  onAskCycles: () => void
  /** A file of the cycle on show chosen. */
  onCycleFile: (path: string) => void
}

/**
 * The guide at the bottom left: its pill, its card, or the tour. Opening moves the focus to the
 * title; folding gives it back to the pill, if it was in the guide.
 */
export function GuideDock({
  state,
  dispatch,
  length,
  text,
  steps,
  repoName,
  onChip,
  impact,
  searchIndex,
  onAskImpact,
  onImpactFile,
  route,
  filePaths,
  onAskRoute,
  onRouteFiles,
  onRouteStop,
  routeAsked,
  cycles,
  onAskCycles,
  onCycleFile,
}: GuideDockProps) {
  const dock = useRef<HTMLDivElement>(null)
  const pill = useRef<HTMLButtonElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const routeTo = useRef<HTMLInputElement>(null)
  const shownMode = useRef<GuideMode>(state.mode)

  // Only a change of mode moves the focus: a guide mounted touring (development) leaves it alone.
  useEffect(() => {
    if (state.mode === shownMode.current) {
      return
    }
    shownMode.current = state.mode
    if (state.mode === 'folded') {
      const active = document.activeElement
      if (active === null || active === document.body || dock.current?.contains(active)) {
        pill.current?.focus()
      }
    } else {
      title.current?.focus({ preventScroll: true })
    }
  }, [state.mode])

  // A route asked from a file asks where to: its other field takes the focus, the answer open
  // already or not. After the effect above, which gives it to the title first.
  const askedRoute = useRef(routeAsked)
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new request is heard
  useEffect(() => {
    if (askedRoute.current === routeAsked) {
      return
    }
    askedRoute.current = routeAsked
    if (state.mode === 'route' && state.from !== undefined && state.to === undefined) {
      routeTo.current?.focus({ preventScroll: true })
    }
  }, [routeAsked])

  const questions: GuideQuestion[] = [
    { ...IMPACT_QUESTION, icon: 'foundation', onAsk: onAskImpact },
    { ...ROUTE_QUESTION, icon: 'route', onAsk: onAskRoute },
    {
      title: CYCLES_QUESTION.title,
      subtitle: CYCLES_QUESTION.subtitle(cycles.cycles.length),
      icon: 'cycle',
      onAsk: onAskCycles,
    },
  ]

  return (
    <div ref={dock} data-guide>
      {state.mode === 'folded' && (
        <GuidePill ref={pill} tour={length !== null} onOpen={() => dispatch({ kind: 'open' })} />
      )}
      {state.mode === 'open' && (
        <GuideCard
          ref={title}
          length={length}
          questions={questions}
          onStart={() => dispatch({ kind: 'start' })}
          onCollapse={() => dispatch({ kind: 'fold' })}
        />
      )}
      {state.mode === 'impact' && (
        <ImpactPanel
          ref={title}
          file={state.file ?? null}
          impact={impact}
          searchIndex={searchIndex}
          onChoose={onImpactFile}
          onBack={() => dispatch({ kind: 'questions' })}
          onClear={() => dispatch({ kind: 'questions' })}
          onCollapse={() => dispatch({ kind: 'fold' })}
        />
      )}
      {state.mode === 'route' && (
        <RoutePanel
          ref={title}
          from={state.from ?? null}
          to={state.to ?? null}
          route={route}
          filePaths={filePaths}
          searchIndex={searchIndex}
          toRef={routeTo}
          onChange={onRouteFiles}
          onNextPath={() => dispatch({ kind: 'next-path' })}
          onStop={onRouteStop}
          onBack={() => dispatch({ kind: 'questions' })}
          onClear={() => dispatch({ kind: 'questions' })}
          onCollapse={() => dispatch({ kind: 'fold' })}
        />
      )}
      {state.mode === 'cycles' && (
        <CyclesPanel
          ref={title}
          cycles={cycles}
          chosen={state.cycle ?? null}
          filePaths={filePaths}
          onChoose={(cycle) => dispatch({ kind: 'cycles', cycle })}
          onFile={onCycleFile}
          onBack={() => dispatch({ kind: 'questions' })}
          onCollapse={() => dispatch({ kind: 'fold' })}
        />
      )}
      {state.mode === 'touring' && text && (
        <TourPanel
          ref={title}
          text={text}
          step={state.step}
          steps={steps}
          repoName={repoName}
          playing={state.playing}
          onPlayPause={() => dispatch({ kind: 'toggle' })}
          onBack={() => dispatch({ kind: 'back' })}
          onNext={() => dispatch({ kind: 'next' })}
          onSkip={() => dispatch({ kind: 'fold' })}
          onChip={onChip}
        />
      )}
    </div>
  )
}
