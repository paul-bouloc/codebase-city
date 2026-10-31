import { useEffect, useRef, useState } from 'react'
import { exactCount } from '../count-format'
import { Icon } from '../Icon'
import { FOLDED_ROWS } from './ranked-files'
import styles from './SymbolList.module.css'
import type { FileSymbol } from './sheet-data'

const TEXT = {
  line: (line: number) => `L${exactCount(line)}`,
  showAll: (count: number) => `Show all (${exactCount(count)})`,
}

const GROUPS = [
  { title: 'Classes', kinds: ['class'] },
  { title: 'Functions', kinds: ['function'] },
  { title: 'Types', kinds: ['interface', 'type', 'enum'] },
] as const satisfies readonly { title: string; kinds: readonly FileSymbol['kind'][] }[]

interface SymbolListProps {
  // Exported symbols only.
  symbols: readonly FileSymbol[]
  // Opens the code at that line.
  onOpenLine: (line: number) => void
  defaultExpanded?: boolean
}

// Exported symbols grouped by kind, in file order within a group; 8 rows until expanded.
export function SymbolList({ symbols, onOpenLine, defaultExpanded = false }: SymbolListProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const firstAdded = useRef<HTMLButtonElement>(null)
  const moveFocus = useRef(false)

  // "Show all" goes away: the focus moves to the first symbol it adds.
  useEffect(() => {
    if (expanded && moveFocus.current) {
      moveFocus.current = false
      firstAdded.current?.focus()
    }
  }, [expanded])

  let budget = expanded ? Number.POSITIVE_INFINITY : FOLDED_ROWS

  const groups = GROUPS.map(({ title, kinds }) => {
    const all = symbols
      .filter((symbol) => (kinds as readonly string[]).includes(symbol.kind))
      .sort((a, b) => a.line - b.line)
    const shown = all.slice(0, budget)
    budget -= shown.length
    return { title, shown }
  }).filter(({ shown }) => shown.length > 0)
  // Rows in reading order across the groups: the 9th is the first one "Show all" adds.
  let row = 0

  return (
    <div className={styles.block}>
      {groups.map(({ title, shown }) => (
        <div key={title} className={styles.group}>
          <h4 className={styles.title}>{title}</h4>
          <ul className={styles.list}>
            {shown.map((symbol) => (
              <li key={`${symbol.name}-${symbol.line}`}>
                <button
                  ref={row++ === FOLDED_ROWS ? firstAdded : undefined}
                  type="button"
                  className={styles.row}
                  onClick={() => onOpenLine(symbol.line)}
                >
                  <Icon name="symbol" size={18} className={styles.icon} />
                  <span className={styles.name}>
                    {symbol.name} <span className={styles.kind}>{symbol.kind}</span>
                  </span>
                  <span className={styles.line}>{TEXT.line(symbol.line)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {!expanded && symbols.length > FOLDED_ROWS && (
        <button
          type="button"
          className={styles.showAll}
          onClick={() => {
            moveFocus.current = true
            setExpanded(true)
          }}
        >
          {TEXT.showAll(symbols.length)}
        </button>
      )}
    </div>
  )
}
