import { describe, expect, it } from 'vitest'
import { cameraKey, isSearchKey } from './screen-keys'

const key = (value: string, modifiers: Partial<KeyboardEvent> = {}) =>
  cameraKey({ key: value, metaKey: false, ctrlKey: false, altKey: false, ...modifiers })

describe('cameraKey', () => {
  it('maps + − F T to the camera buttons', () => {
    expect(key('+')).toBe('zoom-in')
    expect(key('=')).toBe('zoom-in')
    expect(key('-')).toBe('zoom-out')
    expect(key('f')).toBe('recenter')
    expect(key('T')).toBe('top-view')
  })

  it('leaves other keys and shortcuts with a modifier alone', () => {
    expect(key('w')).toBeNull()
    expect(key('+', { metaKey: true })).toBeNull()
    expect(key('f', { ctrlKey: true })).toBeNull()
  })
})

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
