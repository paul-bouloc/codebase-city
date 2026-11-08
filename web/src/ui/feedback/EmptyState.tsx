import type { ReactNode } from 'react'
import { ISLAND_COLORS, LOGO_COLORS } from '../logo-art'
import styles from './EmptyState.module.css'

const TEXT = {
  illustration: 'An empty island waiting for a city',
}

// Artwork in the city's flat colours, fixed like the logo's.
function EmptyIsland() {
  return (
    <svg
      className={styles.illustration}
      width="160"
      height="104"
      viewBox="0 0 160 104"
      role="img"
      aria-label={TEXT.illustration}
    >
      <ellipse cx="80" cy="80" rx="74" ry="20" fill={LOGO_COLORS.sea} fillOpacity="0.55" />
      <ellipse cx="80" cy="76" rx="54" ry="16" fill={LOGO_COLORS.cliff} />
      <ellipse cx="80" cy="71" rx="54" ry="16" fill={LOGO_COLORS.sand} />
      <ellipse cx="80" cy="64" rx="38" ry="11" fill={LOGO_COLORS.cliffShadow} />
      <ellipse cx="80" cy="60" rx="38" ry="11" fill={LOGO_COLORS.meadow} />
      <path d="M80 60V26" stroke={LOGO_COLORS.ink} strokeWidth="2" strokeLinecap="round" />
      <path d="M80 27l18 6-18 6Z" fill={ISLAND_COLORS.flag} />
      <path d="M60 62l4-6 4 6Z M98 63l3-5 3 5Z" fill={ISLAND_COLORS.tree} />
    </svg>
  )
}

interface EmptyStateProps {
  title: string
  children: ReactNode
  // The main action, or a text link in the compact form.
  action?: ReactNode
  // For search results and lists: no frame, no illustration.
  compact?: boolean
}

export function EmptyState({ title, children, action, compact = false }: EmptyStateProps) {
  return (
    <div className={compact ? `${styles.empty} ${styles.compact}` : styles.empty}>
      {!compact && <EmptyIsland />}
      <p className={styles.title}>{title}</p>
      <p className={styles.text}>{children}</p>
      {action && <div className={styles.action}>{action}</div>}
    </div>
  )
}
