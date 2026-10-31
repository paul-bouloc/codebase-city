import type { CSSProperties } from 'react'
import styles from './Logo.module.css'
import { MARK_DISC, MARK_SHAPES, MARK_SIZE } from './logo-art'

const TEXT = {
  name: 'Codebase City',
  first: 'Codebase',
  second: 'City',
}

// Wordmark size relative to the mark, as drawn on the logo board.
const WORDMARK_RATIO = { full: 13 / 24, compact: 11 / 28 }
// Tracking tightens further from this font size up.
const DISPLAY_FONT_SIZE = 32

export type LogoVariant = 'full' | 'compact' | 'mark'

interface LogoProps {
  variant?: LogoVariant
  // On cream the mark sits on a sea disc; on sea the island floats on the background.
  surface?: 'cream' | 'sea'
  // Height of the mark in px.
  size?: number
  className?: string
}

export function Logo({ variant = 'full', surface = 'cream', size = 36, className }: LogoProps) {
  const mark = (
    <svg
      className={styles.mark}
      width={size}
      height={size}
      viewBox={`0 0 ${MARK_SIZE} ${MARK_SIZE}`}
      role={variant === 'mark' ? 'img' : undefined}
      aria-label={variant === 'mark' ? TEXT.name : undefined}
      aria-hidden={variant === 'mark' ? undefined : true}
    >
      {surface === 'cream' && <path d={MARK_DISC.d} fill={MARK_DISC.fill} />}
      {MARK_SHAPES.map(({ d, fill }) => (
        <path key={d} d={d} fill={fill} />
      ))}
    </svg>
  )

  if (variant === 'mark') {
    return className ? <span className={className}>{mark}</span> : mark
  }

  const fontSize = size * WORDMARK_RATIO[variant]
  const style = { '--logo-mark': `${size}px`, '--logo-font': `${fontSize}px` } as CSSProperties
  const classes = [
    styles.logo,
    variant === 'compact' && styles.compact,
    fontSize >= DISPLAY_FONT_SIZE && styles.display,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <span className={classes} style={style}>
      {mark}
      {variant === 'full' ? (
        <span className={styles.wordmark}>{TEXT.name}</span>
      ) : (
        <span className={styles.wordmark}>
          <span>{TEXT.first}</span> <span>{TEXT.second}</span>
        </span>
      )}
    </span>
  )
}
