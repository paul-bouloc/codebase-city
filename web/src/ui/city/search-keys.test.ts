import { describe, expect, it } from 'vitest'
import { searchKeyAction } from './search-keys'

const open = { open: true, count: 4, active: 0, query: 'text' }

describe('searchKeyAction', () => {
  it('goes round the options with the arrows', () => {
    expect(searchKeyAction('ArrowDown', open)).toEqual({ type: 'move', index: 1 })
    expect(searchKeyAction('ArrowDown', { ...open, active: 3 })).toEqual({ type: 'move', index: 0 })
    expect(searchKeyAction('ArrowUp', open)).toEqual({ type: 'move', index: 3 })
    expect(searchKeyAction('ArrowUp', { ...open, count: 0 })).toBeNull()
  })

  it('opens a closed palette again on an arrow, if there is a query', () => {
    expect(searchKeyAction('ArrowDown', { ...open, open: false })).toEqual({ type: 'open' })
    expect(searchKeyAction('ArrowDown', { ...open, open: false, query: '' })).toBeNull()
  })

  it('chooses the active option on Enter, when there is one', () => {
    expect(searchKeyAction('Enter', open)).toEqual({ type: 'choose' })
    expect(searchKeyAction('Enter', { ...open, count: 0 })).toBeNull()
    expect(searchKeyAction('Enter', { ...open, open: false })).toBeNull()
  })

  it('steps back on Esc: closes, then empties, then leaves', () => {
    expect(searchKeyAction('Escape', open)).toEqual({ type: 'close' })
    expect(searchKeyAction('Escape', { ...open, open: false })).toEqual({ type: 'clear' })
    expect(searchKeyAction('Escape', { ...open, open: false, query: '' })).toEqual({
      type: 'leave',
    })
  })

  it('leaves the other keys to the field', () => {
    expect(searchKeyAction('a', open)).toBeNull()
    expect(searchKeyAction('ArrowLeft', open)).toBeNull()
  })
})
