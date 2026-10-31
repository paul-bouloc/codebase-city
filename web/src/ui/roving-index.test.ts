import { describe, expect, it } from 'vitest'
import { rovingIndex } from './roving-index'

const NONE_DISABLED = [false, false, false, false]

describe('rovingIndex', () => {
  it('moves right and left', () => {
    expect(rovingIndex('ArrowRight', 1, NONE_DISABLED)).toBe(2)
    expect(rovingIndex('ArrowLeft', 1, NONE_DISABLED)).toBe(0)
  })

  it('wraps around at both ends', () => {
    expect(rovingIndex('ArrowRight', 3, NONE_DISABLED)).toBe(0)
    expect(rovingIndex('ArrowLeft', 0, NONE_DISABLED)).toBe(3)
  })

  it('goes to the first and last item with Home and End', () => {
    expect(rovingIndex('Home', 2, NONE_DISABLED)).toBe(0)
    expect(rovingIndex('End', 1, NONE_DISABLED)).toBe(3)
  })

  it('skips disabled items', () => {
    const disabled = [true, false, true, false]
    expect(rovingIndex('ArrowRight', 1, disabled)).toBe(3)
    expect(rovingIndex('ArrowRight', 3, disabled)).toBe(1)
    expect(rovingIndex('Home', 3, disabled)).toBe(1)
    expect(rovingIndex('End', 1, [false, false, true])).toBe(1)
  })

  it('ignores other keys, Up and Down included', () => {
    expect(rovingIndex('ArrowDown', 0, NONE_DISABLED)).toBeNull()
    expect(rovingIndex('ArrowUp', 0, NONE_DISABLED)).toBeNull()
    expect(rovingIndex('Enter', 0, NONE_DISABLED)).toBeNull()
    expect(rovingIndex('a', 0, NONE_DISABLED)).toBeNull()
  })

  it('returns null when nothing is enabled', () => {
    expect(rovingIndex('ArrowRight', 0, [true, true])).toBeNull()
    expect(rovingIndex('Home', 0, [true, true])).toBeNull()
    expect(rovingIndex('ArrowRight', 0, [])).toBeNull()
  })

  it('moves with Up and Down in a vertical group, and ignores Left and Right', () => {
    expect(rovingIndex('ArrowDown', 0, NONE_DISABLED, 'vertical')).toBe(1)
    expect(rovingIndex('ArrowUp', 0, NONE_DISABLED, 'vertical')).toBe(NONE_DISABLED.length - 1)
    expect(rovingIndex('ArrowRight', 0, NONE_DISABLED, 'vertical')).toBeNull()
  })
})
