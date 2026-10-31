import styles from './Badge.module.css'
import { Icon } from './Icon'
import type { IconName } from './icons'
import { Spinner } from './Spinner'

export type FileRole =
  | 'entry-point'
  | 'foundation'
  | 'conductor'
  | 'facade'
  | 'test'
  | 'config'
  | 'generated'

export type Language = 'typescript' | 'javascript' | 'css' | 'other'

export type AnalysisStatus = 'queued' | 'building' | 'done' | 'failed' | 'cancelled'

const ROLE_LABELS: Record<FileRole, string> = {
  'entry-point': 'Entry point',
  foundation: 'Foundation',
  conductor: 'Conductor',
  facade: 'Facade',
  test: 'Test',
  config: 'Config',
  generated: 'Generated',
}

export const LANGUAGE_LABELS: Record<Language, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  css: 'CSS',
  other: 'Not analyzed',
}

const STATUS_LABELS: Record<AnalysisStatus, string> = {
  queued: 'Queued',
  building: 'Building',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

// `building` shows the spinner instead of an icon.
const STATUS_ICONS: Record<Exclude<AnalysisStatus, 'building'>, IconName> = {
  queued: 'clock',
  done: 'check',
  failed: 'close',
  cancelled: 'minus',
}

const TEXT = {
  likely: 'likely',
}

export type BadgeProps =
  // A role found by a heuristic rather than a measure is shown as "likely", with a dashed border.
  | { kind: 'role'; fileRole: FileRole; likely?: boolean }
  // `name` writes a language without an analyzer ("PowerShell"), drawn in the `other` colour.
  | { kind: 'language'; language: Language; name?: string }
  | { kind: 'status'; status: AnalysisStatus }

export function Badge(props: BadgeProps) {
  if (props.kind === 'role') {
    const classes = [styles.badge, styles.role, props.likely && styles.likely]
      .filter(Boolean)
      .join(' ')
    return (
      <span className={classes}>
        <Icon name={props.fileRole} size={14} />
        {ROLE_LABELS[props.fileRole]}
        {props.likely && ` · ${TEXT.likely}`}
      </span>
    )
  }

  if (props.kind === 'language') {
    return (
      <span className={`${styles.badge} ${styles.language}`} data-language={props.language}>
        <span className={styles.dot} />
        {props.name ?? LANGUAGE_LABELS[props.language]}
      </span>
    )
  }

  const { status } = props
  return (
    <span className={`${styles.badge} ${styles[status]}`}>
      {status === 'building' ? (
        <Spinner className={styles.spinner} />
      ) : (
        <Icon name={STATUS_ICONS[status]} size={14} />
      )}
      {STATUS_LABELS[status]}
    </span>
  )
}
