import { describe, expect, it } from 'vitest'
import { bearingOf, northOf, roundForChart, scaleFiles } from './map-scale'

describe('scaleFiles', () => {
  it('counts the files of a square as wide as the bar', () => {
    // 96 px over 4 px a unit: a 24 u square, 576 u², at one file every 4 u² (a lot): 144 files
    expect(scaleFiles(4, 0.25)).toBe(200)
    // 96 px over 5 px a unit: 19.2 u, 369 u², 92 files
    expect(scaleFiles(5, 0.25)).toBe(100)
    // Closer in, fewer files: 96 px over 48 px a unit is 2 u, a single lot
    expect(scaleFiles(48, 0.25)).toBe(1)
  })

  it('says 1 file rather than nothing', () => {
    expect(scaleFiles(1000, 0.25)).toBe(1)
    expect(scaleFiles(0, 0.25)).toBe(1)
    expect(scaleFiles(4, 0)).toBe(1)
  })
})

describe('roundForChart', () => {
  it('rounds to 1, 2 or 5 times a power of ten', () => {
    // Nearest on a log scale: 141 is halfway between 100 and 200
    expect(roundForChart(130)).toBe(100)
    expect(roundForChart(150)).toBe(200)
    expect(roundForChart(380)).toBe(500)
    expect(roundForChart(800)).toBe(1000)
    expect(roundForChart(3)).toBe(2)
    expect(roundForChart(0.4)).toBe(1)
  })
})

describe('bearingOf', () => {
  it('turns clockwise from north as the camera turns anticlockwise', () => {
    expect(bearingOf(0)).toBe(0)
    expect(bearingOf(-Math.PI / 2)).toBe(90)
    expect(bearingOf(Math.PI / 2)).toBe(270)
    expect(bearingOf(4 * Math.PI + 0.001)).toBe(0)
  })
})

describe('northOf', () => {
  it('finds the nearest turn that faces north', () => {
    expect(northOf(0.5)).toBe(0)
    expect(northOf(2 * Math.PI - 0.5)).toBeCloseTo(2 * Math.PI)
    expect(northOf(-7)).toBeCloseTo(-2 * Math.PI)
  })
})
