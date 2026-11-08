import { describe, expect, it } from 'vitest'
import { cameraKey } from './camera-keys'

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
