import { useId } from 'react'
import type { FileRole } from '../Badge'
import { Icon } from '../Icon'
import styles from './RoleBadge.module.css'

const TEXT = {
  likely: '· likely',
  why: 'Measured from imports. “Likely” because roles are inferred, not declared.',
}

export const ROLE_NAMES: Record<FileRole, string> = {
  'entry-point': 'Entry point',
  foundation: 'Foundation',
  conductor: 'Conductor',
  facade: 'Facade',
  test: 'Test',
  config: 'Config',
  generated: 'Generated',
}

interface RoleBadgeProps {
  fileRole: FileRole
  // The transitive measure behind the role (P9), never a count of direct imports.
  reason: string
}

// An inferred role always says "likely". Hover or focus tells why, in an ink tooltip.
export function RoleBadge({ fileRole, reason }: RoleBadgeProps) {
  const tipId = useId()
  return (
    <span className={styles.anchor}>
      <button type="button" className={styles.badge} aria-describedby={tipId}>
        <Icon name={fileRole} size={14} />
        {ROLE_NAMES[fileRole]}
        <span className={styles.likely}>{TEXT.likely}</span>
      </button>
      <span id={tipId} role="tooltip" className={styles.tip}>
        <span className={styles.tipTitle}>
          {ROLE_NAMES[fileRole]} {TEXT.likely}
        </span>
        <span>{reason}</span>
        <span className={styles.tipNote}>{TEXT.why}</span>
      </span>
    </span>
  )
}
