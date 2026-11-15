import { forwardRef, useEffect, useRef, useState } from 'react'
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

const QUESTION = 'Where are the cycles?'

/** The question in the guide's list, its line under it counting the city's cycles. */
export function cyclesQuestion(cycles: number) {
  return { title: QUESTION, subtitle: cyclesSubtitle(cycles) }
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
  // A cycle chosen past the first rows shows them all, for it to be seen; they stay shown.
  if (!all && (chosen ?? 0) >= SHOWN_CYCLES) {
    setAll(true)
  }
  const count = cycles.cycles.length
  const shown = all ? cycles.cycles : cycles.cycles.slice(0, SHOWN_CYCLES)
  // "Show all" goes as it is pressed: the focus goes on to the first row it brought.
  const list = useRef<HTMLUListElement>(null)
  const [opened, setOpened] = useState(false)
  useEffect(() => {
    if (opened) {
      setOpened(false)
      list.current
        ?.querySelectorAll<HTMLButtonElement>(':scope > li > button')
        [SHOWN_CYCLES]?.focus()
    }
  }, [opened])
  const summary = cyclesSummary(count, cycles.files)
  return (
    <QuestionPanel
      ref={titleRef}
      title={QUESTION}
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
          <ul ref={list} className={styles.list} aria-label={TEXT.list}>
            {shown.map((cycle, at) => (
              // A row keeps its button open or not: the focus stays on it when it opens.
              <li key={cycle.row} className={at === chosen ? styles.chosen : undefined}>
                <button
                  type="button"
                  className={styles.cycle}
                  aria-expanded={at === chosen}
                  aria-label={cycleLabel(cycle.members.length, cycle.folders)}
                  onClick={() => onChoose(at)}
                >
                  <CycleHead cycle={cycle} />
                </button>
                {at === chosen && (
                  <CycleFiles cycle={cycle} filePaths={filePaths} onFile={onFile} />
                )}
              </li>
            ))}
          </ul>
          {shown.length < count && (
            <button
              type="button"
              className={styles.all}
              onClick={() => {
                setAll(true)
                setOpened(true)
              }}
            >
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
function CycleFiles({
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
  return (
    <>
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
    </>
  )
}
