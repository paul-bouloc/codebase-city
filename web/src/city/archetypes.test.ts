import { describe, expect, it } from 'vitest'
import { archetypeFor, buildingFor, floorsFor, footprintFor } from './archetypes'
import type { FileMetrics } from './layout'

const file = (metrics: Partial<FileMetrics>): FileMetrics => ({
  language: 'typescript',
  lines: 100,
  complexity: 1,
  test: false,
  ...metrics,
})

describe('floorsFor', () => {
  it('crosses each archetype threshold at the documented complexity', () => {
    expect(floorsFor(3)).toBe(2)
    expect(floorsFor(4)).toBe(3)
    expect(floorsFor(15)).toBe(5)
    expect(floorsFor(16)).toBe(6)
    expect(floorsFor(51)).toBe(10)
    expect(floorsFor(52)).toBe(11)
    expect(floorsFor(117)).toBe(16)
    expect(floorsFor(118)).toBe(17)
  })

  it('gives 33 floors for a complexity of 412', () => {
    expect(floorsFor(412)).toBe(33)
  })

  it('stays between 1 and 40 floors', () => {
    expect(floorsFor(0)).toBe(1)
    expect(floorsFor(574)).toBe(39)
    expect(floorsFor(575)).toBe(40)
    expect(floorsFor(100_000)).toBe(40)
  })
})

describe('footprintFor', () => {
  it('gives 1.61 u for 2,481 lines', () => {
    expect(footprintFor(2481)).toBeCloseTo(1.61, 2)
  })

  it('stays between 0.75 and 1.70 u', () => {
    expect(footprintFor(0)).toBe(0.75)
    expect(footprintFor(3000)).toBeCloseTo(1.7)
    expect(footprintFor(50_000)).toBeCloseTo(1.7)
  })
})

describe('archetypeFor', () => {
  it('follows the number of floors', () => {
    expect(archetypeFor(1, 1, false)).toBe('house')
    expect(archetypeFor(3, 1, false)).toBe('smallBlock')
    expect(archetypeFor(6, 1, false)).toBe('setbackBlock')
    expect(archetypeFor(11, 1, false)).toBe('pyramidRoof')
    expect(archetypeFor(17, 1, false)).toBe('towerOnPodium')
  })

  it('makes a Hall of a low building with a wide footprint', () => {
    expect(archetypeFor(2, 1.5, false)).toBe('hall')
    expect(archetypeFor(2, 1.49, false)).toBe('house')
    expect(archetypeFor(3, 1.7, false)).toBe('smallBlock')
  })

  it('makes a Pavilion of every test, whatever its size', () => {
    expect(archetypeFor(40, 1.7, true)).toBe('pavilion')
  })
})

describe('buildingFor', () => {
  it('switches a simple file to a Hall at 1,870 lines', () => {
    expect(buildingFor(file({ lines: 1869 })).archetype).toBe('house')
    expect(buildingFor(file({ lines: 1870 })).archetype).toBe('hall')
  })

  it('caps the Pavilion at 1.54 u so its roof fits the lot', () => {
    expect(buildingFor(file({ lines: 3000, test: true })).side).toBe(1.54)
    expect(buildingFor(file({ lines: 0, test: true })).side).toBe(0.75)
  })

  it('stops the walls of a House under its roof', () => {
    expect(buildingFor(file({ complexity: 3 })).height).toBeCloseTo(0.9)
  })

  it('gives the Setback block a base of 62 % of its floors', () => {
    expect(buildingFor(file({ complexity: 40 }))).toMatchObject({
      archetype: 'setbackBlock',
      height: 4.5,
      split: 3,
    })
  })
})
