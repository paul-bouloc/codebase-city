import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from 'react'
import { exactCount, shortCount } from '../count-format'
import { rovingIndex } from './roving-index'
import styles from './Tabs.module.css'

export interface TabItem {
  id: string
  label: string
  // Shown in a pill after the label ("Imported by 1,204").
  count?: number
  disabled?: boolean
}

interface TabsProps {
  label: string
  tabs: readonly TabItem[]
  selected: string
  onSelect: (id: string) => void
  // The selected tab's panel.
  children: ReactNode
  // Tighter tabs with plain mono counts, to fit four in a 400 px sheet.
  compact?: boolean
}

// Arrows, Home and End move between tabs and select them on the way.
export function Tabs({ label, tabs, selected, onSelect, children, compact = false }: TabsProps) {
  const baseId = useId()
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const listRef = useRef<HTMLDivElement>(null)
  const selectedIndex = tabs.findIndex((tab) => tab.id === selected)
  // The list keeps a tab stop even when the selected tab is unknown or disabled.
  const tabStop =
    selectedIndex !== -1 && !tabs[selectedIndex]?.disabled
      ? selectedIndex
      : tabs.findIndex((tab) => !tab.disabled)
  // Indexes, not caller ids, so any id makes a valid IDREF.
  const tabId = (index: number) => `${baseId}-tab-${index}`
  const panelId = `${baseId}-panel`

  // The list scrolls sideways when tabs overflow: keep the selected one in view, without
  // scrolling anything else.
  useEffect(() => {
    const list = listRef.current
    const tab = tabRefs.current[selectedIndex]
    if (!list || !tab) {
      return
    }
    if (tab.offsetLeft < list.scrollLeft) {
      list.scrollLeft = tab.offsetLeft
    } else if (tab.offsetLeft + tab.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollLeft = tab.offsetLeft + tab.offsetWidth - list.clientWidth
    }
  }, [selectedIndex])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // From the focused tab: the parent may not follow every selection.
    const focused = tabRefs.current.indexOf(event.target as HTMLButtonElement)
    const next = rovingIndex(
      event.key,
      focused === -1 ? Math.max(0, tabStop) : focused,
      tabs.map((tab) => tab.disabled === true),
    )
    const tab = next === null ? undefined : tabs[next]
    if (next === null || !tab) {
      return
    }
    event.preventDefault()
    onSelect(tab.id)
    tabRefs.current[next]?.focus()
  }

  return (
    <div className={compact ? `${styles.tabs} ${styles.compact}` : styles.tabs}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        className={styles.list}
        onKeyDown={handleKeyDown}
      >
        {tabs.map((tab, index) => {
          const isSelected = index === selectedIndex
          return (
            <button
              key={tab.id}
              ref={(element) => {
                tabRefs.current[index] = element
              }}
              id={tabId(index)}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={isSelected ? panelId : undefined}
              tabIndex={index === tabStop ? 0 : -1}
              disabled={tab.disabled}
              className={styles.tab}
              onClick={() => onSelect(tab.id)}
            >
              {tab.label}
              {tab.count !== undefined &&
                (compact && tab.count >= 1000 ? (
                  // Four characters at most, so the tabs fit whatever the counts; read in full.
                  <>
                    <span className={styles.count} title={exactCount(tab.count)} aria-hidden="true">
                      {shortCount(tab.count)}
                    </span>
                    <span className="visually-hidden">{exactCount(tab.count)}</span>
                  </>
                ) : (
                  <span className={styles.count}>{exactCount(tab.count)}</span>
                ))}
            </button>
          )
        })}
      </div>
      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={selectedIndex === -1 ? undefined : tabId(selectedIndex)}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the APG tabs pattern makes the panel a tab stop
        tabIndex={0}
        className={styles.panel}
      >
        {children}
      </div>
    </div>
  )
}
