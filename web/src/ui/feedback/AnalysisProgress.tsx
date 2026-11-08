import type { ReactNode } from 'react'
import { Badge } from '../Badge'
import { Icon } from '../Icon'
import styles from './AnalysisProgress.module.css'
import {
  BUILD_STEPS,
  type BuildStep,
  type ProgressOutcome,
  progressStatus,
  type StepState,
  stepStates,
} from './analysis-steps'

const TEXT = {
  steps: {
    queued: 'Queued',
    downloading: 'Downloading',
    reading: 'Reading files',
    parsing: 'Parsing',
    resolving: 'Resolving imports',
    mapping: 'Mapping the architecture',
    building: 'Building the city',
  } satisfies Record<BuildStep, string>,
  states: {
    done: 'done',
    current: 'in progress',
    upcoming: 'upcoming',
    failed: 'failed',
    cancelled: 'cancelled',
  } satisfies Record<StepState, string>,
  titles: {
    queued: 'Waiting for a builder…',
    running: 'Building the city…',
    paused: 'Waiting for GitHub…',
    done: 'Your city is ready',
    failed: 'The city couldn’t be built',
    cancelled: 'Build cancelled',
  },
  list: 'Build steps',
}

function progressTitle(step: BuildStep, outcome: ProgressOutcome): string {
  if (outcome === 'running' || outcome === 'reconnecting') {
    return step === 'queued' ? TEXT.titles.queued : TEXT.titles.running
  }
  return TEXT.titles[outcome]
}

interface AnalysisProgressProps {
  // `owner/repo`.
  repo: string
  step: BuildStep
  outcome?: ProgressOutcome
  // Right-hand figures per step ("22 / 38 MB", "stopped").
  meta?: Partial<Record<BuildStep, string>>
  // A second line under a step's name.
  detail?: Partial<Record<BuildStep, string>>
  // A bar under the current step.
  progress?: { value: number; max: number; label: string }
  // Under the current step, such as the button to cancel while queued.
  stepAction?: ReactNode
  // Below the steps: alerts, actions, the note about leaving the page.
  children?: ReactNode
}

export function AnalysisProgress({
  repo,
  step,
  outcome = 'running',
  meta = {},
  detail = {},
  progress,
  stepAction,
  children,
}: AnalysisProgressProps) {
  const states = stepStates(step, outcome)
  const slash = repo.indexOf('/')
  const warning = outcome === 'reconnecting' || outcome === 'paused'

  return (
    <section className={styles.card} data-outcome={outcome}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.repo}>
            {repo.slice(0, slash + 1)}
            <b>{repo.slice(slash + 1)}</b>
          </span>
          <h1 className={styles.title}>{progressTitle(step, outcome)}</h1>
        </div>
        <Badge kind="status" status={progressStatus(step, outcome)} />
      </header>

      <ol className={styles.steps} aria-label={TEXT.list}>
        {BUILD_STEPS.map((id, index) => {
          const state = states[index] ?? 'upcoming'
          const current = state === 'current'
          const classes = [styles.step, styles[state], current && warning && styles.warning]
            .filter(Boolean)
            .join(' ')
          return (
            <li key={id} className={classes} aria-current={current ? 'step' : undefined}>
              <span className={styles.rail}>
                <span className={styles.marker}>
                  {state === 'done' && <Icon name="check" size={14} />}
                  {state === 'failed' && <Icon name="close" size={14} />}
                  {state === 'cancelled' && <Icon name="minus" size={14} />}
                </span>
                {index < BUILD_STEPS.length - 1 && <span className={styles.line} />}
              </span>
              <span className={styles.body}>
                <span className={styles.name}>
                  {TEXT.steps[id]}
                  <span className="visually-hidden">, {TEXT.states[state]}</span>
                </span>
                {detail[id] && <span className={styles.detail}>{detail[id]}</span>}
                {current && progress && (
                  <progress
                    className={styles.bar}
                    aria-label={progress.label}
                    value={progress.value}
                    max={progress.max}
                  />
                )}
                {current && stepAction}
              </span>
              <span className={styles.meta}>{meta[id]}</span>
            </li>
          )
        })}
      </ol>

      {children}
    </section>
  )
}
