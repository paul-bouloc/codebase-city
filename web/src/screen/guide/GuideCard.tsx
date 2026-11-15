import { forwardRef } from 'react'
import { Kbd } from '../../ui/actions/Kbd'
import { Icon } from '../../ui/brand/Icon'
import type { IconName } from '../../ui/brand/icons'
import { Glass } from '../parts/Glass'
import styles from './GuideCard.module.css'

const TEXT = {
  open: 'Open the guide',
  collapse: 'Collapse the guide',
  title: 'Guide',
  pill: 'Take the tour or ask a question',
  pillNoTour: 'Ask a question',
  subtitle: 'Only facts measured in the code',
  tour: 'Take the tour',
  key: 'Space',
  questions: 'Questions',
}

/** A question the guide answers: its title, and the line under it shown on hover. */
export interface GuideQuestion {
  title: string
  subtitle: string
  icon: IconName
  onAsk: () => void
}

interface GuidePillProps {
  /** The city has a tour to take. */
  tour: boolean
  onOpen: () => void
}

/** The guide folded: a pill at the bottom left, which opens it. */
export const GuidePill = forwardRef<HTMLButtonElement, GuidePillProps>(function GuidePill(
  { tour, onOpen },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={styles.pill}
      // Space on the pill starts the tour (use-guide), as the key it shows says.
      data-tour-space
      aria-expanded={false}
      aria-label={TEXT.open}
      onClick={onOpen}
    >
      <span className={styles.tile}>
        <Icon name="guide" size={20} />
      </span>
      <span className={styles.words}>
        <span className={styles.pillTitle}>{TEXT.title}</span>
        <span className={styles.pillHint}>{tour ? TEXT.pill : TEXT.pillNoTour}</span>
      </span>
      {tour && <Kbd>{TEXT.key}</Kbd>}
      <Icon name="chevron-up" size={16} />
    </button>
  )
})

interface GuideCardProps {
  /** "9 steps · about 2 min", or null when the city has no tour. */
  length: string | null
  questions: readonly GuideQuestion[]
  onStart: () => void
  onCollapse: () => void
}

/** The guide open: what it is, the way into the tour, and the questions it answers. */
export const GuideCard = forwardRef<HTMLHeadingElement, GuideCardProps>(function GuideCard(
  { length, questions, onStart, onCollapse },
  titleRef,
) {
  return (
    <Glass as="section" className={styles.card} aria-label={TEXT.title}>
      <div className={styles.head}>
        <span className={styles.tile}>
          <Icon name="guide" size={20} />
        </span>
        <div className={styles.headWords}>
          <h2 ref={titleRef} tabIndex={-1} className={styles.title}>
            {TEXT.title}
          </h2>
          <span className={styles.subtitle}>{TEXT.subtitle}</span>
        </div>
        <button
          type="button"
          className={styles.collapse}
          aria-label={TEXT.collapse}
          aria-expanded={true}
          onClick={onCollapse}
        >
          <Icon name="chevron-down" size={18} />
        </button>
      </div>
      {length !== null && (
        <button type="button" className={styles.start} onClick={onStart}>
          <span className={styles.startLabel}>
            <Icon name="play" size={16} />
            {TEXT.tour}
          </span>
          <span className={styles.startEnd}>
            <span className={styles.length}>{length}</span>
            <Kbd tone="inverse">{TEXT.key}</Kbd>
          </span>
        </button>
      )}
      {questions.length > 0 && (
        <div className={styles.questions}>
          <h3 className={styles.eyebrow}>{TEXT.questions}</h3>
          <ul className={styles.questionList}>
            {questions.map((question) => (
              <li key={question.title}>
                <button type="button" className={styles.question} onClick={question.onAsk}>
                  <span className={styles.questionTile}>
                    <Icon name={question.icon} size={16} />
                  </span>
                  <span className={styles.questionWords}>
                    <span className={styles.questionTitle}>{question.title}</span>
                    <span className={styles.questionMore}>
                      <span className={styles.questionSubtitle}>{question.subtitle}</span>
                    </span>
                  </span>
                  <Icon name="chevron-down" size={16} className={styles.questionChevron} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Glass>
  )
})
