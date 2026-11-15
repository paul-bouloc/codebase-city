import { forwardRef, useState } from 'react'
import { exactCount } from '../../../ui/display/count-format'
import styles from './CyclesPanel.module.css'
import { type CycleList, type CycleRow, SHOWN_CYCLES } from './cycles'
import {
  cycleFolders,
  cycleLabel,
  cycleMore,
  cyclesSubtitle,
  cyclesSummary,
  NO_CYCLES,
  showAllCycles,
} from './cycles-text'
import { QuestionPanel } from './QuestionPanel'

export const CYCLES_QUESTION = {
  title: 'Where are the cycles?',
  /** The line under the question in the list, with the count of cycles. */
  subtitle: cyclesSubtitle,
}

const TEXT = {
  subtitle: 'Files that end up importing themselves',
  list: 'Cycles, biggest first',
}

const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)

interface CyclesPanelProps {
  cycles: CycleList
  /** The cycle on show, by its place in the list. */
  chosen: number | null
  /** Every file's path, by file. */
  filePaths: readonly string[]
  onChoose: (cycle: number) => void
  /** A file of the cycle chosen: it opens. */
  onFile: (path: string) => void
  onBack: () => void
  onCollapse: () => void
}

/** The answer to "Where are the cycles?": every cycle, the biggest first, one of them open. */
export const CyclesPanel = forwardRef<HTMLHeadingElement, CyclesPanelProps>(function CyclesPanel(
  { cycles, chosen, filePaths, onChoose, onFile, onBack, onCollapse },
  titleRef,
) {
  const [all, setAll] = useState(false)
  const count = cycles.cycles.length
  // A cycle chosen past the first rows shows them all, for it to be seen.
  const shown =
    all || (chosen ?? 0) >= SHOWN_CYCLES ? cycles.cycles : cycles.cycles.slice(0, SHOWN_CYCLES)
  const summary = cyclesSummary(count, cycles.files)
  return (
    <QuestionPanel
      ref={titleRef}
      title={CYCLES_QUESTION.title}
      subtitle={TEXT.subtitle}
      onBack={onBack}
      onCollapse={onCollapse}
    >
      {count === 0 ? (
        <p className={styles.none}>{NO_CYCLES}</p>
      ) : (
        <>
          <p className={styles.summary}>
            <strong className={styles.count}>{summary.cycles}</strong>
            {summary.rest}
          </p>
          <ul className={styles.list} aria-label={TEXT.list}>
            {shown.map((cycle, at) => (
              <li key={cycle.row}>
                {at === chosen ? (
                  <ChosenCycle cycle={cycle} filePaths={filePaths} onFile={onFile} />
                ) : (
                  <button
                    type="button"
                    className={styles.cycle}
                    aria-label={cycleLabel(cycle.members.length, cycle.folders)}
                    onClick={() => onChoose(at)}
                  >
                    <CycleHead cycle={cycle} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {shown.length < count && (
            <button type="button" className={styles.all} onClick={() => setAll(true)}>
              {showAllCycles(count)}
            </button>
          )}
        </>
      )}
    </QuestionPanel>
  )
})

/** A cycle's badge and folders. */
function CycleHead({ cycle }: { cycle: CycleRow }) {
  const folders = cycleFolders(cycle.folders)
  return (
    <>
      <span className={styles.badge} aria-hidden="true">
        {exactCount(cycle.members.length)}
      </span>
      <span className={styles.folders} title={folders} aria-hidden="true">
        <span className={styles.foldersText}>{folders}</span>
      </span>
    </>
  )
}

/** The cycle on show, open: the files of its loop in import order, then how many more. */
function ChosenCycle({
  cycle,
  filePaths,
  onFile,
}: {
  cycle: CycleRow
  filePaths: readonly string[]
  onFile: (path: string) => void
}) {
  const loop = cycle.loop.map((file) => filePaths[file] ?? '')
  const more = cycle.members.length - loop.length
  const label = cycleLabel(cycle.members.length, cycle.folders)
  return (
    <section className={`${styles.cycle} ${styles.chosen}`} aria-label={label} aria-current="true">
      <div className={styles.head}>
        <CycleHead cycle={cycle} />
      </div>
      <ol className={styles.files}>
        {loop.map((path) => (
          <li key={path}>
            <button type="button" className={styles.file} title={path} onClick={() => onFile(path)}>
              {nameOf(path)}
            </button>
          </li>
        ))}
      </ol>
      {more > 0 && <p className={styles.more}>{cycleMore(more)}</p>}
    </section>
  )
}
