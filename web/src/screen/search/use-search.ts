import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { isSearchKey } from '../keys/screen-keys'
import { type SearchHit, type SearchResults, searchOptions } from './search-data'
import { normalizeQuery, type SearchIndex } from './search-index'
import { searchKeyAction } from './search-keys'

export interface Search {
  listboxId: string
  inputRef: RefObject<HTMLInputElement | null>
  /** The query in the field. */
  query: string
  /** The query the results on show answer, normalized. */
  shownQuery: string
  results: SearchResults
  options: SearchHit[]
  /** The option the arrows reached. */
  active: number
  setActive: (option: number) => void
  suggestion: string | null
  paletteShown: boolean
  setFocused: (focused: boolean) => void
  changeQuery: (value: string) => void
  chooseHit: (hit: SearchHit) => void
  handleKey: (event: ReactKeyboardEvent) => void
}

/**
 * The search field and its palette, which shows under it while it has the focus and a query.
 * `onChoose` takes what was found, once the field has let go so the city's keys work again.
 */
export function useSearch(searchIndex: SearchIndex, onChoose: (hit: SearchHit) => void): Search {
  const listboxId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [activeOption, setActiveOption] = useState(0)
  // The field shows each key at once; the results follow, and give way to the next key.
  const shownQuery = useDeferredValue(query)
  const results = useMemo(() => searchIndex.search(shownQuery), [searchIndex, shownQuery])
  const options = useMemo(() => searchOptions(results), [results])
  // Shown once the results are a query's, not the empty field's: no flash of "Nothing matches".
  const paletteShown = focused && normalizeQuery(query) !== '' && normalizeQuery(shownQuery) !== ''
  // The option the arrows reached, within the results on show (fewer, after a new query).
  const active = options.length === 0 ? 0 : Math.min(activeOption, options.length - 1)
  const suggestion = useMemo(
    () => (paletteShown && options.length === 0 ? searchIndex.suggest(shownQuery) : null),
    [paletteShown, options, searchIndex, shownQuery],
  )

  const changeQuery = (value: string) => {
    setQuery(value)
    setActiveOption(0)
    setFocused(true)
  }

  const chooseHit = (hit: SearchHit) => {
    inputRef.current?.blur()
    setFocused(false)
    onChoose(hit)
  }

  // Keys in the field or in its results (the suggestion): Enter and Space on a button are its own.
  const handleKey = (event: ReactKeyboardEvent) => {
    const onButton = event.target !== inputRef.current
    // A button is no field: without this, the city's keys (arrows, Esc) would act behind it.
    if (onButton) {
      event.stopPropagation()
    }
    if (
      event.nativeEvent.isComposing ||
      (onButton && (event.key === 'Enter' || event.key === ' '))
    ) {
      return
    }
    const action = searchKeyAction(event.key, {
      open: paletteShown,
      count: options.length,
      active,
      query,
    })
    if (!action) {
      return
    }
    // Esc taken here is not the screen's: it closes no sheet.
    event.preventDefault()
    switch (action.type) {
      case 'move':
        setActiveOption(action.index)
        break
      case 'open':
        setFocused(true)
        break
      case 'choose': {
        // The results on show may still be an older query's: Enter takes the query in the field.
        const hit =
          shownQuery === query ? options[active] : searchOptions(searchIndex.search(query))[0]
        if (hit) {
          chooseHit(hit)
        }
        break
      }
      case 'close':
        setFocused(false)
        // From the suggestion, which goes with the results: back to the field.
        inputRef.current?.focus()
        break
      case 'clear':
        changeQuery('')
        setFocused(false)
        break
      case 'leave':
        inputRef.current?.blur()
        break
    }
  }

  // / and ⌘K (Ctrl+K) go to the search field, its query selected to be typed over.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isSearchKey(event)) {
        return
      }
      const input = inputRef.current
      if (!input || input.disabled) {
        return
      }
      event.preventDefault()
      input.focus()
      input.select()
      setFocused(true)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  return {
    listboxId,
    inputRef,
    query,
    shownQuery: normalizeQuery(shownQuery),
    results,
    options,
    active,
    setActive: setActiveOption,
    suggestion,
    paletteShown,
    setFocused,
    changeQuery,
    chooseHit,
    handleKey,
  }
}
