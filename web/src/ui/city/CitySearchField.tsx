import { type Ref, useRef } from 'react'
import { Icon } from '../Icon'
import { Kbd } from '../Kbd'
import styles from './CitySearchField.module.css'

const TEXT = {
  label: 'Search files, folders and symbols',
  placeholder: 'Search files, folders, symbols',
  clear: 'Clear search',
  shortcut: '/',
}

interface CitySearchFieldProps {
  value: string
  onChange: (value: string) => void
  // The results palette, once open (outside this component).
  expanded?: boolean
  listboxId?: string
  inputRef?: Ref<HTMLInputElement>
  // Until the search index has arrived.
  disabled?: boolean
}

// The field alone: the palette of results is drawn by the city screen.
export function CitySearchField({
  value,
  onChange,
  expanded = false,
  listboxId,
  inputRef,
  disabled = false,
}: CitySearchFieldProps) {
  const ownRef = useRef<HTMLInputElement>(null)

  const setRefs = (element: HTMLInputElement | null) => {
    ownRef.current = element
    if (typeof inputRef === 'function') {
      inputRef(element)
    } else if (inputRef) {
      inputRef.current = element
    }
  }

  return (
    <search aria-label={TEXT.label} className={styles.field}>
      <Icon name="search" size={18} className={styles.icon} />
      <input
        ref={setRefs}
        type="text"
        role="combobox"
        aria-label={TEXT.label}
        aria-expanded={expanded}
        aria-controls={expanded ? listboxId : undefined}
        aria-autocomplete="list"
        aria-keyshortcuts="/"
        className={styles.input}
        placeholder={TEXT.placeholder}
        value={value}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button
          type="button"
          className={styles.clear}
          aria-label={TEXT.clear}
          onClick={() => {
            onChange('')
            ownRef.current?.focus()
          }}
        >
          <Icon name="close" size={16} />
        </button>
      ) : (
        <span className={styles.key} aria-hidden="true">
          <Kbd>{TEXT.shortcut}</Kbd>
        </span>
      )}
    </search>
  )
}
