import { describe, expect, it } from 'vitest'
import { boardToThree, layerAltitude, srgb } from './units'

describe('layerAltitude', () => {
  it('raises each layer by 0.45 u from 0.6 u', () => {
    expect([1, 2, 3, 4, 5].map(layerAltitude)).toEqual(
      [0.6, 1.05, 1.5, 1.95, 2.4].map((altitude) => expect.closeTo(altitude)),
    )
  })

  it('keeps out-of-range layers within 1 to 5', () => {
    expect(layerAltitude(0)).toBeCloseTo(0.6)
    expect(layerAltitude(9)).toBeCloseTo(2.4)
  })
})

describe('boardToThree', () => {
  it('turns z-up board coordinates into y-up three.js ones', () => {
    expect(boardToThree(1, 2, 3)).toEqual([1, 3, -2])
  })

  it('keeps the board right-handed: north (+y) faces -z', () => {
    const [, , z] = boardToThree(0, 10, 0)
    expect(z).toBe(-10)
  })
})

describe('srgb', () => {
  it('reads #rrggbb into channels in [0, 1]', () => {
    expect(srgb('#4F9EA5')).toEqual([0x4f / 255, 0x9e / 255, 0xa5 / 255])
    expect(srgb('#ffffff')).toEqual([1, 1, 1])
  })

  it('rejects anything else', () => {
    expect(() => srgb('#fff')).toThrow('Not a #rrggbb colour')
    expect(() => srgb('teal')).toThrow()
  })
})
