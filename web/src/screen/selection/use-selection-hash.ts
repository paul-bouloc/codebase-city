import { useEffect, useRef } from 'react'
import type { CityEngine } from '../../city/engine/city-engine'
import { hashOf, type ScreenSelection, selectionOfHash } from './selection-hash'

/**
 * Keeps the selection in the fragment: read once the city is there (again for a new result, which
 * makes a new `choose`) and on Back or Forward; each new selection gets its own history entry.
 */
export function useSelectionHash(
  engine: CityEngine | null,
  selection: ScreenSelection | null,
  choose: (next: ScreenSelection | null) => void,
): void {
  const hashRead = useRef(false)
  useEffect(() => {
    if (!engine) {
      return
    }
    const apply = () => choose(selectionOfHash(window.location.hash))
    apply()
    hashRead.current = true
    window.addEventListener('popstate', apply)
    window.addEventListener('hashchange', apply)
    return () => {
      window.removeEventListener('popstate', apply)
      window.removeEventListener('hashchange', apply)
    }
  }, [engine, choose])

  useEffect(() => {
    if (!hashRead.current) {
      return
    }
    // The same selection spelt another way (`@` left unescaped) is no new entry.
    const current = selectionOfHash(window.location.hash)
    if (current?.kind !== selection?.kind || current?.path !== selection?.path) {
      const { pathname, search } = window.location
      window.history.pushState(null, '', hashOf(selection) || `${pathname}${search}`)
    }
  }, [selection])
}
