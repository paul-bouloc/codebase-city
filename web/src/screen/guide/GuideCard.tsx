import { forwardRef } from 'react'
import { Kbd } from '../../ui/actions/Kbd'
import { Icon } from '../../ui/brand/Icon'
import { Glass } from '../parts/Glass'
import styles from './GuideCard.module.css'

const TEXT = {
  open: 'Open the guide',
  collapse: 'Collapse the guide',
  title: 'Guide',
  pill: 'Take a tour of the city',
  subtitle: 'Only facts measured in the code',
  tour: 'Take the tour',
  key: 'Space',
}

interface GuidePillProps {
  onOpen: () => void
}

/** The guide folded: a pill at the bottom left, which opens it. */
export const GuidePill = forwardRef<HTMLButtonElement, GuidePillProps>(function GuidePill(
  { onOpen },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={styles.pill}
      aria-expanded={false}
      aria-label={TEXT.open}
      onClick={onOpen}
    >
      <span className={styles.tile}>
        <Icon name="guide" size={20} />
      </span>
      <span className={styles.words}>
        <span className={styles.pillTitle}>{TEXT.title}</span>
        <span className={styles.pillHint}>{TEXT.pill}</span>
      </span>
      <Kbd>{TEXT.key}</Kbd>
      <Icon name="chevron-up" size={16} />
    </button>
  )
})

interface GuideCardProps {
  /** "9 steps · about 2 min", or null when the city has no tour. */
  length: string | null
  onStart: () => void
  onCollapse: () => void
}

/** The guide open: what it is, and the way into the tour. */
export const GuideCard = forwardRef<HTMLHeadingElement, GuideCardProps>(function GuideCard(
  { length, onStart, onCollapse },
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
    </Glass>
  )
})
