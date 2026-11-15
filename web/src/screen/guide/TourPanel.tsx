import { forwardRef, useEffect, useRef } from 'react'
import { Button } from '../../ui/actions/Button'
import { Icon } from '../../ui/brand/Icon'
import type { IconName } from '../../ui/brand/icons'
import { Glass } from '../parts/Glass'
import styles from './TourPanel.module.css'
import { TourSpans } from './TourSpans'
import type { TourTarget, TourText } from './tour/tour-spans'
import { useContentHeight } from './use-content-height'

const TEXT = {
  label: 'Guide',
  step: (at: number, of: number, title: string) => `Step ${at} of ${of} · ${title}`,
  skip: 'Skip tour',
  progress: 'Tour progress',
  closer: 'Look closer',
  back: 'Back',
  next: 'Next',
  done: 'Done',
  pause: 'Pause the tour',
  resume: 'Resume the tour',
  pauseTitle: 'Pause · Space',
  playTitle: 'Play · Space',
  backTitle: 'Previous step · ←',
  nextTitle: 'Next step · →',
}

const CHIP_ICONS: Record<TourTarget['kind'], IconName> = {
  file: 'file',
  folder: 'folder',
  islands: 'search',
  next: 'arrow-right',
}

interface TourPanelProps {
  text: TourText
  /** The step on show, from 0, and how many the tour has. */
  step: number
  steps: number
  repoName: string
  /** The tour goes on to the next step on its own. */
  playing: boolean
  onPlayPause: () => void
  onBack: () => void
  /** Next, or Done on the last step. */
  onNext: () => void
  onSkip: () => void
  onChip: (target: TourTarget) => void
}

/** A step of the tour: where it stands, what it says, what to look at closer, and the way on. */
export const TourPanel = forwardRef<HTMLHeadingElement, TourPanelProps>(function TourPanel(
  { text, step, steps, repoName, playing, onPlayPause, onBack, onNext, onSkip, onChip },
  titleRef,
) {
  const last = step === steps - 1
  // The panel eases from the height of one step to the next.
  const { boxRef, contentRef, height } = useContentHeight<HTMLDivElement, HTMLDivElement>()
  // Back goes with the first step: the focus it had goes on to Next.
  const nextRef = useRef<HTMLButtonElement>(null)
  const back = () => {
    if (step === 1) {
      nextRef.current?.focus()
    }
    onBack()
  }
  // A step that plays on removes its chips, and the focus one had: it goes to the step's title.
  // Where the focus was is read as the new step renders, while the old chips are still there.
  const shownStep = useRef(step)
  const focusWasIn = useRef(false)
  if (shownStep.current !== step) {
    shownStep.current = step
    focusWasIn.current = boxRef.current?.contains(document.activeElement) ?? false
  }
  useEffect(() => {
    const box = boxRef.current
    if (focusWasIn.current && box && !box.contains(document.activeElement)) {
      focusWasIn.current = false
      box.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true })
    }
  })
  return (
    <Glass
      ref={boxRef}
      as="section"
      className={styles.panel}
      style={{ height }}
      aria-label={TEXT.label}
    >
      <div ref={contentRef} className={styles.content}>
        <div className={styles.head}>
          <h2 ref={titleRef} tabIndex={-1} className={styles.step}>
            {TEXT.step(step + 1, steps, text.title)}
          </h2>
          <button type="button" className={styles.skip} onClick={onSkip}>
            {TEXT.skip}
          </button>
        </div>
        <div
          className={styles.progress}
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={steps}
          aria-valuenow={step + 1}
          aria-label={TEXT.progress}
        >
          {Array.from({ length: steps }, (_, at) => (
            <span
              // The dots of a tour never move: their place is their key.
              // biome-ignore lint/suspicious/noArrayIndexKey: one dot per step, in order
              key={at}
              className={`${styles.dot} ${at === step ? styles.current : ''} ${at <= step ? styles.done : ''}`}
            />
          ))}
        </div>
        {/* A new step fades in; the region that reads it out stays. */}
        <div className={styles.said}>
          <div aria-live="polite">
            <p key={step} className={`${styles.text} ${styles.fade}`}>
              <TourSpans spans={text.text} repoName={repoName} onChip={onChip} />
            </p>
          </div>
          {text.closer.length > 0 && (
            <div key={step} className={`${styles.closer} ${styles.fade}`}>
              <span className={styles.eyebrow}>{TEXT.closer}</span>
              <ul className={styles.chips}>
                {text.closer.map((chip, at) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the chips of a step never move
                  <li key={at}>
                    <button
                      type="button"
                      className={styles.chip}
                      onClick={() => onChip(chip.target)}
                    >
                      <Icon
                        name={CHIP_ICONS[chip.target.kind]}
                        size={14}
                        className={styles.chipIcon}
                      />
                      <span>
                        <TourSpans spans={chip.spans} repoName={repoName} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className={styles.commands}>
          {step > 0 && (
            <Button icon="arrow-left" onClick={back} title={TEXT.backTitle}>
              {TEXT.back}
            </Button>
          )}
          <Button
            iconOnly
            icon={playing ? 'pause' : 'play'}
            label={playing ? TEXT.pause : TEXT.resume}
            title={playing ? TEXT.pauseTitle : TEXT.playTitle}
            onClick={onPlayPause}
          />
          <span className={styles.spacer} />
          <Button
            ref={nextRef}
            variant="guide"
            onClick={onNext}
            title={last ? undefined : TEXT.nextTitle}
          >
            {last ? TEXT.done : TEXT.next}
            {!last && <Icon name="arrow-right" size={16} />}
          </Button>
        </div>
      </div>
    </Glass>
  )
})
