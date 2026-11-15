import { useEffect, useRef } from 'react'
import { GuideCard, GuidePill } from './GuideCard'
import type { GuideAction, GuideMode, GuideState } from './guide-state'
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
}: GuideDockProps) {
  const dock = useRef<HTMLDivElement>(null)
  const pill = useRef<HTMLButtonElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
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

  return (
    <div ref={dock} data-guide>
      {state.mode === 'folded' && (
        <GuidePill ref={pill} onOpen={() => dispatch({ kind: 'open' })} />
      )}
      {state.mode === 'open' && (
        <GuideCard
          ref={title}
          length={length}
          onStart={() => dispatch({ kind: 'start' })}
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
          onBack={() => dispatch({ kind: 'back' })}
          onNext={() => dispatch({ kind: 'next' })}
          onSkip={() => dispatch({ kind: 'fold' })}
          onChip={onChip}
        />
      )}
    </div>
  )
}
