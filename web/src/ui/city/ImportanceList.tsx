import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { exactCount } from '../count-format'
import styles from './ImportanceList.module.css'
import { FOLDED_ROWS, rankedRows } from './ranked-files'
import type { RankedFile } from './sheet-data'
import { splitPath } from './shorten-folder'

const TEXT = {
  usedBy: (count: number) => `used by ${exactCount(count)}`,
  importedBy: (count: number) => `imported by ${exactCount(count)}`,
  showAll: (count: number) => `Show all (${exactCount(count)})`,
  note: 'Sorted by importance: how many files depend on each one.',
  root: '(root)',
}

interface ImportanceListProps {
  rows: readonly RankedFile[]
  // Navy bars for what the file imports, sun bars for what imports it.
  direction: 'imports' | 'importedBy'
  // Selects that file; the sheet follows.
  onSelect: (path: string) => void
  defaultExpanded?: boolean
}

// Files ranked by how many depend on them. "Show all (N)" unfolds the list in place and moves
// the focus to the first row it adds.
export function ImportanceList({
  rows,
  direction,
  onSelect,
  defaultExpanded = false,
}: ImportanceListProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const firstAdded = useRef<HTMLButtonElement>(null)
  const moveFocus = useRef(false)
  // Sorting 1,204 importers is not free: once per list and fold, not on every render.
  const { shown, total, max } = useMemo(() => rankedRows(rows, expanded), [rows, expanded])

  useEffect(() => {
    if (expanded && moveFocus.current) {
      moveFocus.current = false
      firstAdded.current?.focus()
    }
  }, [expanded])

  return (
    <div className={styles.block}>
      <ul className={styles.list}>
        {shown.map((row, index) => {
          const { folder, name } = splitPath(row.path)
          const fill = { '--fill': max > 0 ? row.importers / max : 0 } as CSSProperties
          return (
            <li key={row.path}>
              <button
                ref={index === FOLDED_ROWS ? firstAdded : undefined}
                type="button"
                className={styles.row}
                title={row.path}
                onClick={() => onSelect(row.path)}
              >
                <span className={`${styles.bar} ${styles[direction]}`} style={fill} />
                <span className={styles.names}>
                  <span className={styles.name}>{name}</span>
                  <span className={styles.folder}>{folder || TEXT.root}</span>
                </span>
                <span className={styles.meta}>
                  {direction === 'imports'
                    ? TEXT.usedBy(row.importers)
                    : TEXT.importedBy(row.importers)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {!expanded && total > FOLDED_ROWS && (
        <button
          type="button"
          className={styles.showAll}
          onClick={() => {
            moveFocus.current = true
            setExpanded(true)
          }}
        >
          {TEXT.showAll(total)}
        </button>
      )}
      {total > 1 && <p className={styles.note}>{TEXT.note}</p>}
    </div>
  )
}
