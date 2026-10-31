import { type KeyboardEvent, type ReactNode, useId, useRef } from 'react'
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
}

const COUNT_FORMAT = new Intl.NumberFormat('en-US')

// Arrows, Home and End move between tabs and select them on the way.
export function Tabs({ label, tabs, selected, onSelect, children }: TabsProps) {
  const baseId = useId()
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const selectedIndex = tabs.findIndex((tab) => tab.id === selected)
  const tabId = (id: string) => `${baseId}-tab-${id}`
  const panelId = `${baseId}-panel`

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = rovingIndex(
      event.key,
      Math.max(0, selectedIndex),
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
    <div className={styles.tabs}>
      <div role="tablist" aria-label={label} className={styles.list} onKeyDown={handleKeyDown}>
        {tabs.map((tab, index) => {
          const isSelected = index === selectedIndex
          return (
            <button
              key={tab.id}
              ref={(element) => {
                tabRefs.current[index] = element
              }}
              id={tabId(tab.id)}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={isSelected ? panelId : undefined}
              tabIndex={isSelected ? 0 : -1}
              disabled={tab.disabled}
              className={styles.tab}
              onClick={() => onSelect(tab.id)}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className={styles.count}>{COUNT_FORMAT.format(tab.count)}</span>
              )}
            </button>
          )
        })}
      </div>
      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={selectedIndex === -1 ? undefined : tabId(selected)}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the APG tabs pattern makes the panel a tab stop
        tabIndex={0}
        className={styles.panel}
      >
        {children}
      </div>
    </div>
  )
}
