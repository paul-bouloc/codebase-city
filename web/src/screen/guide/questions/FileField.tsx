import { type KeyboardEvent, useId, useMemo, useRef, useState } from 'react'
import { Icon } from '../../../ui/brand/Icon'
import { useTruncatedPath } from '../../../ui/display/use-truncated-path'
import type { FileHit } from '../../search/search-data'
import { normalizeQuery, type SearchIndex } from '../../search/search-index'
import styles from './FileField.module.css'

const TEXT = {
  clear: 'Clear',
  placeholder: 'Search a file',
}

/** The files the list offers: the search's best ones, files alone. */
const LIMITS = { files: 8, folders: 0, symbols: 0 }

interface FileFieldProps {
  label: string
  /** The file chosen, by path; none while the field is empty. */
  value: string | null
  searchIndex: SearchIndex
  onChoose: (path: string | null) => void
}

/**
 * A field to choose a file in: it shows the file chosen, its path cut from the start; typed in,
 * it lists the files the search finds.
 */
export function FileField({ label, value, searchIndex, onChoose }: FileFieldProps) {
  const id = useId()
  const listboxId = `${id}-files`
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const editing = query !== null
  const { ref: fitRef, text: fitted } = useTruncatedPath<HTMLInputElement>(value ?? '')
  const hits = useMemo<FileHit[]>(
    () =>
      query !== null && normalizeQuery(query) !== ''
        ? searchIndex.search(query, LIMITS).files.hits
        : [],
    [query, searchIndex],
  )
  const expanded = editing && hits.length > 0
  const shown = Math.min(active, Math.max(0, hits.length - 1))

  const setRefs = (element: HTMLInputElement | null) => {
    inputRef.current = element
    fitRef.current = element
  }
  const choose = (path: string) => {
    setQuery(null)
    onChoose(path)
  }
  const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (hits.length > 0) {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setActive((shown + step + hits.length) % hits.length)
      }
    } else if (event.key === 'Enter') {
      const hit = hits[shown]
      if (hit) {
        event.preventDefault()
        choose(hit.path)
        inputRef.current?.blur()
      }
    } else if (event.key === 'Escape' && editing) {
      // The list closes, and only it: the screen's Esc waits for the next press.
      event.preventDefault()
      setQuery(null)
      inputRef.current?.blur()
    }
  }

  return (
    <div className={styles.box}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.field}>
        <input
          ref={setRefs}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={expanded ? listboxId : undefined}
          aria-activedescendant={expanded ? `${listboxId}-${shown}` : undefined}
          aria-autocomplete="list"
          className={styles.input}
          placeholder={TEXT.placeholder}
          // Away from the field, the path gives way from its start; typed in, it is the query.
          value={editing ? query : fitted}
          title={value ?? undefined}
          autoComplete="off"
          spellCheck={false}
          onFocus={(event) => {
            setQuery(value ?? '')
            setActive(0)
            const input = event.currentTarget
            requestAnimationFrame(() => input.select())
          }}
          onBlur={() => setQuery(null)}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={handleKey}
        />
        {value !== null && !editing && (
          <button
            type="button"
            className={styles.clear}
            aria-label={TEXT.clear}
            title={TEXT.clear}
            onClick={() => {
              onChoose(null)
              inputRef.current?.focus()
              // The focus started an edit from the file just cleared: the field is empty now.
              setQuery('')
            }}
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      {expanded && (
        <div id={listboxId} role="listbox" aria-label={label} className={styles.list}>
          {hits.map((hit, at) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: the field takes the keys for its list
            <div
              key={hit.path}
              id={`${listboxId}-${at}`}
              role="option"
              aria-selected={at === shown}
              // Pointed at by the field, never focused (aria-activedescendant).
              tabIndex={-1}
              className={`${styles.option} ${at === shown ? styles.active : ''}`}
              title={hit.path}
              // The field keeps the focus: a press here must not blur it before the click.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(at)}
              onClick={() => {
                choose(hit.path)
                inputRef.current?.blur()
              }}
            >
              <Icon name="file" size={16} className={styles.optionIcon} />
              <span className={styles.optionPath}>
                <span className={styles.optionFolder}>
                  <span className={styles.optionFolderText}>
                    {hit.path.slice(0, hit.nameStart)}
                  </span>
                </span>
                <span className={styles.optionName}>{hit.path.slice(hit.nameStart)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
