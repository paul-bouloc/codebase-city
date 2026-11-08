import type { ReactNode } from 'react'
import { Icon } from '../brand/Icon'
import type { IconName } from '../brand/icons'
import styles from './InlineAlert.module.css'

export type AlertTone = 'info' | 'success' | 'warning' | 'error' | 'neutral'

const ICONS: Record<AlertTone, IconName> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'alert-circle',
  neutral: 'minus-circle',
}

interface InlineAlertProps {
  tone: AlertTone
  title: ReactNode
  // The explanation under the title; a title alone is allowed.
  children?: ReactNode
  // A link or a button under the text.
  action?: ReactNode
  // Replaces the tone's icon, such as a clock while waiting for GitHub.
  icon?: IconName
  // One line, smaller: "Reconnecting…".
  compact?: boolean
}

// No role of its own: to be announced, it is rendered inside a `LiveRegion` that is already there.
export function InlineAlert({
  tone,
  title,
  children,
  action,
  icon,
  compact = false,
}: InlineAlertProps) {
  const classes = [styles.alert, styles[tone], compact && styles.compact].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      <Icon name={icon ?? ICONS[tone]} size={compact ? 16 : 20} className={styles.icon} />
      <div className={styles.text}>
        <span className={styles.title}>{title}</span>
        {children && <span className={styles.body}>{children}</span>}
        {action && <div className={styles.action}>{action}</div>}
      </div>
    </div>
  )
}
