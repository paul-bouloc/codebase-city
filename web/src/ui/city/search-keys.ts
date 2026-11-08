// What a key pressed in the search field does to the palette under it.

export type SearchKeyAction =
  /** Make this option the active one. */
  | { type: 'move'; index: number }
  /** Show the palette again, closed on a query. */
  | { type: 'open' }
  /** Fly to the active option and select it. */
  | { type: 'choose' }
  /** Close the palette, the query kept. */
  | { type: 'close' }
  /** Empty the field. */
  | { type: 'clear' }
  /** Leave the field. */
  | { type: 'leave' }

export interface SearchKeyState {
  /** The palette is showing. */
  open: boolean
  /** How many options it holds. */
  count: number
  active: number
  query: string
}

/**
 * The arrows go round the options, Enter chooses one. Esc steps back: it closes the palette,
 * then empties the field, then leaves it.
 */
export function searchKeyAction(key: string, state: SearchKeyState): SearchKeyAction | null {
  const { open, count, active, query } = state
  switch (key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      if (!open) {
        return query ? { type: 'open' } : null
      }
      if (count === 0) {
        return null
      }
      const step = key === 'ArrowDown' ? 1 : -1
      return { type: 'move', index: (active + step + count) % count }
    }
    case 'Enter':
      return open && count > 0 ? { type: 'choose' } : null
    case 'Escape':
      if (open) {
        return { type: 'close' }
      }
      return query ? { type: 'clear' } : { type: 'leave' }
    default:
      return null
  }
}
