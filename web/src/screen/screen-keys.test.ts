import { describe, expect, it } from 'vitest'
import { isSearchKey } from './screen-keys'

const search = (value: string, modifiers: Partial<KeyboardEvent> = {}) =>
  isSearchKey({
    key: value,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target: null,
    ...modifiers,
  })

describe('isSearchKey', () => {
  it('takes / and ⌘K or Ctrl+K', () => {
    expect(search('/')).toBe(true)
    expect(search('k', { metaKey: true })).toBe(true)
    expect(search('k', { ctrlKey: true })).toBe(true)
    expect(search('K', { metaKey: true })).toBe(true)
  })

  it('leaves k alone, and the other shortcuts', () => {
    expect(search('k')).toBe(false)
    expect(search('k', { metaKey: true, shiftKey: true })).toBe(false)
    expect(search('k', { metaKey: true, altKey: true })).toBe(false)
    expect(search('/', { metaKey: true })).toBe(false)
  })
})
