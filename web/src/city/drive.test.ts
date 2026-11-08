import { describe, expect, it } from 'vitest'
import { driveOf, isDriveKey, STILL } from './drive'

describe('driveOf', () => {
  it('is still with no key', () => {
    expect(driveOf([])).toEqual(STILL)
  })

  it('moves ahead, aside and turns', () => {
    expect(driveOf(['KeyW'])).toEqual({ right: 0, forward: 1, turn: 0 })
    expect(driveOf(['KeyA', 'KeyS'])).toEqual({ right: -1, forward: -1, turn: 0 })
    expect(driveOf(['KeyD', 'KeyE'])).toEqual({ right: 1, forward: 0, turn: -1 })
    expect(driveOf(['KeyQ'])).toEqual({ right: 0, forward: 0, turn: 1 })
  })

  it('cancels opposite keys out', () => {
    expect(driveOf(['KeyW', 'KeyS', 'KeyQ', 'KeyE'])).toEqual(STILL)
  })

  it('ignores other keys and repeats', () => {
    expect(driveOf(['KeyW', 'KeyW', 'ArrowUp', 'KeyF'])).toEqual({
      right: 0,
      forward: 1,
      turn: 0,
    })
  })
})

describe('isDriveKey', () => {
  it('knows the six keys by their place, not their letter', () => {
    expect(isDriveKey('KeyW')).toBe(true)
    expect(isDriveKey('KeyE')).toBe(true)
    expect(isDriveKey('KeyZ')).toBe(false)
    expect(isDriveKey('ArrowUp')).toBe(false)
  })
})
