import type { ReactNode } from 'react'
import styles from './QuotaIndicator.module.css'
import { filledSegments, QUOTA_SEGMENTS, quotaTone } from './quota'

const TEXT = {
  cardTitle: (left: number, limit: number) => `${left} of ${limit} analyses left today`,
  chip: (left: number) => `${left} left today`,
  none: 'No analyses left today',
  meter: 'Analyses left today',
  states: { available: 'Available', low: 'Low', exhausted: 'Exhausted' },
}

interface QuotaIndicatorProps {
  left: number
  limit: number
  // `chip` sits in the site header; `card` on the Build and account pages.
  variant?: 'card' | 'chip'
  // Card only. Depends on the page: when the quota resets, what is still free.
  note?: ReactNode
}

export function QuotaIndicator({ left, limit, variant = 'card', note }: QuotaIndicatorProps) {
  const tone = quotaTone(left)
  const filled = filledSegments(left, limit)
  const segments = Array.from({ length: QUOTA_SEGMENTS }, (_, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: the segments never move
    <span key={index} className={index < filled ? styles.filled : styles.empty} />
  ))

  if (variant === 'chip') {
    return (
      <span className={`${styles.chip} ${styles[tone]}`}>
        <span className={styles.chipSegments} aria-hidden="true">
          {segments}
        </span>
        {tone === 'exhausted' ? TEXT.none : TEXT.chip(left)}
      </span>
    )
  }

  return (
    <div className={`${styles.card} ${styles[tone]}`}>
      <div className={styles.head}>
        <span className={styles.title}>
          {tone === 'exhausted' ? TEXT.none : TEXT.cardTitle(left, limit)}
        </span>
        <span className={styles.state}>{TEXT.states[tone]}</span>
      </div>
      {/* A native meter for assistive tech; the drawn segments are only a picture of it. */}
      <meter
        className="visually-hidden"
        aria-label={TEXT.meter}
        min={0}
        max={limit}
        value={Math.max(0, left)}
      />
      <div className={styles.segments} aria-hidden="true">
        {segments}
      </div>
      {note && <p className={styles.note}>{note}</p>}
    </div>
  )
}
