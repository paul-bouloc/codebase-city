import type { Mesh } from 'three'
import { describe, expect, it } from 'vitest'
import { createFerries } from './ferries'

const ferry = {
  a: 0,
  b: 1,
  imports: 10,
  upward: false,
  width: 0.8,
  path: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 5 },
  ],
}

describe('createFerries', () => {
  it('draws the lines that go down in one mesh and those that go up in another', () => {
    const group = createFerries([ferry, ferry, { ...ferry, upward: true }], 1)
    const [down, up] = group.children as Mesh[]
    // Two segments per line, four corners per segment.
    expect(down?.geometry.getAttribute('corner').count).toBe(2 * 2 * 4)
    expect(up?.geometry.getAttribute('corner').count).toBe(2 * 4)
  })

  it('draws nothing for no line, nor for a line of a single point', () => {
    expect(createFerries([], 1).children).toHaveLength(0)
    expect(createFerries([{ ...ferry, path: [{ x: 0, y: 0 }] }], 1).children).toHaveLength(0)
  })
})
