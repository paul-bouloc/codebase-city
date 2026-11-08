import { describe, expect, it } from 'vitest'
import { type WheelInput, WheelSorter } from './wheel-gesture'

function wheel(deltaY: number, more: Partial<WheelInput> = {}): WheelInput {
  return { deltaX: 0, deltaY, deltaMode: 0, ctrlKey: false, ...more }
}

describe('WheelSorter', () => {
  it('takes a flagged event for a pinch', () => {
    expect(new WheelSorter().sort(wheel(-3, { ctrlKey: true }), 0)).toBe('pinch')
  })

  it('knows a wheel by its notches', () => {
    expect(new WheelSorter().sort(wheel(4.000244140625), 0)).toBe('wheel')
    expect(new WheelSorter().sort(wheel(-12.000732421875), 0)).toBe('wheel')
    expect(new WheelSorter().sort(wheel(100), 0)).toBe('wheel')
    expect(new WheelSorter().sort(wheel(-120), 0)).toBe('wheel')
    expect(new WheelSorter().sort(wheel(3, { deltaMode: 1 }), 0)).toBe('wheel')
  })

  it('takes small or sideways steps for two fingers', () => {
    expect(new WheelSorter().sort(wheel(2), 0)).toBe('scroll')
    expect(new WheelSorter().sort(wheel(17), 0)).toBe('scroll')
    expect(new WheelSorter().sort(wheel(0.5), 0)).toBe('scroll')
    expect(new WheelSorter().sort(wheel(0, { deltaX: 6 }), 0)).toBe('scroll')
    expect(new WheelSorter().sort(wheel(100, { deltaX: 1 }), 0)).toBe('scroll')
  })

  it('keeps a gesture its kind while its events follow each other', () => {
    const sorter = new WheelSorter()
    expect(sorter.sort(wheel(3), 0)).toBe('scroll')
    expect(sorter.sort(wheel(120), 16)).toBe('scroll')
    expect(sorter.sort(wheel(4.000244140625), 200)).toBe('scroll')
  })

  it('sorts again after a pause', () => {
    const sorter = new WheelSorter()
    expect(sorter.sort(wheel(3), 0)).toBe('scroll')
    expect(sorter.sort(wheel(4.000244140625), 201)).toBe('wheel')
  })

  it('lets a pinch through a gesture without changing it', () => {
    const sorter = new WheelSorter()
    expect(sorter.sort(wheel(100), 0)).toBe('wheel')
    expect(sorter.sort(wheel(-2, { ctrlKey: true }), 10)).toBe('pinch')
    expect(sorter.sort(wheel(3), 20)).toBe('wheel')
  })
})
