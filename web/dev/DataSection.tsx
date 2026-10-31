import { useState } from 'react'
import { AnalysisProgress } from '../src/ui/AnalysisProgress'
import type { BuildStep, ProgressOutcome } from '../src/ui/analysis-steps'
import { type AnalysisStatus, Badge, type FileRole, type Language } from '../src/ui/Badge'
import { Button } from '../src/ui/Button'
import { ListRow } from '../src/ui/ListRow'
import { QuotaIndicator } from '../src/ui/QuotaIndicator'
import styles from './DataSection.module.css'

const TEXT = {
  title: 'Data',
  hint: 'Compare with the “DS · Components 2 · Data & panels” board. Click a row to select it; drag the corner of the narrow list to watch the paths shorten.',
  badges: 'Badges',
  roles: 'File role',
  languages: 'Language',
  statuses: 'Analysis status',
  listRows: 'File list rows',
  narrow: 'Narrow, resizable',
  quota: 'Quota',
  chips: 'Header chip',
  progress: 'Analysis progress',
  leave:
    'You can leave this page, the city will keep building. It will be in My account and in the gallery.',
  cancel: 'Cancel and get your analysis back',
}

const ROLES: FileRole[] = [
  'entry-point',
  'foundation',
  'conductor',
  'facade',
  'test',
  'config',
  'generated',
]
const LANGUAGES: Language[] = ['typescript', 'javascript', 'css', 'other']
const STATUSES: AnalysisStatus[] = ['queued', 'building', 'done', 'failed', 'cancelled']

interface RowSample {
  name: string
  path: string
  lines: number
  incoming: number
  outgoing: number
  fileRole?: FileRole
}

const ROWS: RowSample[] = [
  {
    name: 'application.js',
    path: 'lib/application.js',
    lines: 631,
    incoming: 4,
    outgoing: 11,
    fileRole: 'conductor',
  },
  {
    name: 'index.js',
    path: 'index.js',
    lines: 11,
    incoming: 0,
    outgoing: 1,
    fileRole: 'entry-point',
  },
  {
    name: 'index.js',
    path: 'lib/router/index.js',
    lines: 673,
    incoming: 2,
    outgoing: 7,
    fileRole: 'foundation',
  },
  {
    name: 'terminalInstance.ts',
    path: 'src/vs/workbench/contrib/terminal/browser/terminalInstance.ts',
    lines: 2481,
    incoming: 1204,
    outgoing: 38,
  },
]

const QUOTA_NOTES: Record<number, string> = {
  7: 'Resets at 1:00 AM. Opening a city that already exists is free.',
  2: 'Resets at 1:00 AM. Opening a city that already exists is free.',
  0: 'Resets in 5 h 12 min. You can still explore every city in the gallery.',
}

interface ProgressSample {
  label: string
  step: BuildStep
  outcome: ProgressOutcome
  meta: Partial<Record<BuildStep, string>>
}

const BEFORE_PARSING_META: Partial<Record<BuildStep, string>> = {
  queued: 'waited 1 min',
  downloading: '38 MB',
  reading: '15,212 files',
}

const ALL_DONE_META: Partial<Record<BuildStep, string>> = {
  ...BEFORE_PARSING_META,
  parsing: '15,212 files',
  resolving: '41,903 imports',
  mapping: '6 islands',
}

const PROGRESS: ProgressSample[] = [
  { label: 'Queued', step: 'queued', outcome: 'running', meta: { queued: '3rd in line' } },
  {
    label: 'Parsing',
    step: 'parsing',
    outcome: 'running',
    meta: { ...BEFORE_PARSING_META, parsing: '9,840 / 15,212 files' },
  },
  {
    label: 'Reconnecting',
    step: 'parsing',
    outcome: 'reconnecting',
    meta: { ...BEFORE_PARSING_META, parsing: '9,840 / 15,212 files' },
  },
  {
    label: 'Rate limit',
    step: 'downloading',
    outcome: 'paused',
    meta: { queued: 'waited 12 s', downloading: 'paused at 22 / 38 MB' },
  },
  {
    label: 'Failed',
    step: 'downloading',
    outcome: 'failed',
    meta: { queued: 'waited 12 s', downloading: '512 MB +' },
  },
  { label: 'Cancelled', step: 'queued', outcome: 'cancelled', meta: { queued: 'cancelled' } },
  { label: 'Done', step: 'building', outcome: 'done', meta: ALL_DONE_META },
]

const BUILD_PAST_READING: BuildStep[] = ['parsing', 'resolving', 'mapping', 'building']
const PARSING_PROGRESS = { value: 9840, max: 15212, label: 'Parsing files' }

function RowList({ narrow = false }: { narrow?: boolean }) {
  const [selected, setSelected] = useState(2)
  return (
    <div
      role="listbox"
      aria-label={TEXT.listRows}
      className={narrow ? `${styles.list} ${styles.narrow}` : styles.list}
    >
      {ROWS.map((row, index) => (
        <ListRow
          key={row.path}
          {...row}
          selected={index === selected}
          tabIndex={index === selected ? 0 : -1}
          onClick={() => setSelected(index)}
        />
      ))}
    </div>
  )
}

export function DataSection() {
  return (
    <section id="data" className={styles.section}>
      <h2 className="heading-2">{TEXT.title}</h2>
      <p className={`body-s ${styles.secondary}`}>{TEXT.hint}</p>

      <div className={styles.block}>
        <h3 className="heading-3">{TEXT.badges}</h3>
        <h4 className="eyebrow-mono">{TEXT.roles}</h4>
        <div className={styles.row}>
          {ROLES.map((fileRole) => (
            <Badge key={fileRole} kind="role" fileRole={fileRole} />
          ))}
          <Badge kind="role" fileRole="conductor" likely />
        </div>
        <h4 className="eyebrow-mono">{TEXT.languages}</h4>
        <div className={styles.row}>
          {LANGUAGES.map((language) => (
            <Badge key={language} kind="language" language={language} />
          ))}
        </div>
        <h4 className="eyebrow-mono">{TEXT.statuses}</h4>
        <div className={styles.row}>
          {STATUSES.map((status) => (
            <Badge key={status} kind="status" status={status} />
          ))}
        </div>
      </div>

      <div className={styles.block}>
        <h3 className="heading-3">{TEXT.listRows}</h3>
        <RowList />
        <h4 className="eyebrow-mono">{TEXT.narrow}</h4>
        <RowList narrow />
      </div>

      <div className={styles.block}>
        <h3 className="heading-3">{TEXT.quota}</h3>
        <div className={styles.quota}>
          {[7, 2, 0].map((left) => (
            <QuotaIndicator key={left} left={left} limit={10} note={QUOTA_NOTES[left]} />
          ))}
        </div>
        <h4 className="eyebrow-mono">{TEXT.chips}</h4>
        <div className={styles.row}>
          {[7, 2, 0].map((left) => (
            <QuotaIndicator key={left} variant="chip" left={left} limit={10} />
          ))}
        </div>
      </div>

      <div className={styles.block}>
        <h3 className="heading-3">{TEXT.progress}</h3>
        <div className={styles.progress}>
          {PROGRESS.map((sample) => (
            <div key={sample.label} className={styles.block}>
              <h4 className="eyebrow-mono">{sample.label}</h4>
              <AnalysisProgress
                repo="microsoft/vscode"
                step={sample.step}
                outcome={sample.outcome}
                meta={sample.meta}
                detail={
                  BUILD_PAST_READING.includes(sample.step) && sample.outcome !== 'failed'
                    ? { reading: '15,212 kept · 3,904 skipped (generated, vendored, binary)' }
                    : {}
                }
                progress={sample.step === 'parsing' ? PARSING_PROGRESS : undefined}
                stepAction={
                  sample.step === 'queued' && sample.outcome === 'running' ? (
                    <Button>{TEXT.cancel}</Button>
                  ) : undefined
                }
              >
                {(sample.outcome === 'running' || sample.outcome === 'reconnecting') && (
                  <p className={`body-s ${styles.leave}`}>{TEXT.leave}</p>
                )}
              </AnalysisProgress>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
