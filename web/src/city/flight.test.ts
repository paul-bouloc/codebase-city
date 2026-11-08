import { describe, expect, it } from 'vitest'
import { decodeResult } from '../data/decode-result'
import sample from '../data/generated/sample-result.json'
import {
  type Extent,
  extentOf,
  FRAME_MARGIN,
  flightRadius,
  frameInView,
  freeWidth,
  orbitTilt,
  revealShift,
  turnAbout,
  type Viewport,
} from './flight'
import { cityFromResult } from './from-result'
import { placeBuildings } from './placed-buildings'
import { cityTargets } from './targets'

const layout = cityFromResult(decodeResult(sample))
const placed = placeBuildings(layout)
const targets = cityTargets(layout)

const SCREEN: Viewport = { width: 1440, height: 900, inset: 0, fov: 38 }
const WITH_SHEET: Viewport = { ...SCREEN, inset: 444 }

/** Where a point `distance` u in front of the camera and `side` u to its right lands, in px. */
function onScreen(side: number, distance: number, { width, height, fov }: Viewport): number {
  const tanV = Math.tan((fov * Math.PI) / 360)
  return width / 2 + (side / (distance * tanV)) * (height / 2)
}

describe('extentOf', () => {
  it('stands a file on its building, up to its roof', () => {
    const target = targets.at('src/ui/view.ts')
    const extent = target && extentOf(target, layout, placed)
    const building = target?.kind === 'building' ? placed[target.index] : undefined
    expect(extent?.centre).toEqual(building?.position)
    expect(extent?.folder).toBe(false)
    expect(extent?.height).toBeGreaterThan(building?.building.height ?? Number.POSITIVE_INFINITY)
  })

  it('stands an island on its plateau', () => {
    const target = targets.at('src/core')
    const extent = target && extentOf(target, layout, placed)
    const plateau = target?.kind === 'island' ? layout.islands[target.island]?.plateau : undefined
    expect(extent?.folder).toBe(true)
    expect(extent?.radius).toBeCloseTo(Math.hypot(plateau?.width ?? 0, plateau?.height ?? 0) / 2)
  })
})

describe('flightRadius', () => {
  it('frames a small file with its block, a tall one up to its roof', () => {
    const small: Extent = { centre: [0, 0, 0], radius: 0.5, height: 2, folder: false }
    expect(flightRadius(small)).toBe(10)
    expect(flightRadius({ ...small, height: 20 })).toBe(20.5)
  })

  it('frames a folder whole, with room around', () => {
    expect(flightRadius({ centre: [0, 0, 0], radius: 30, height: 0, folder: true })).toBe(
      30 + FRAME_MARGIN,
    )
  })
})

describe('freeWidth', () => {
  it('leaves the room left of the panel', () => {
    expect(freeWidth(SCREEN)).toBe(1440)
    expect(freeWidth(WITH_SHEET)).toBe(996)
  })

  it('ignores a panel that leaves too little room', () => {
    expect(freeWidth({ ...SCREEN, width: 600 })).toBe(600)
    expect(freeWidth({ ...WITH_SHEET, width: 600 })).toBe(600)
  })
})

describe('frameInView', () => {
  it('frames in the middle of the canvas with no panel', () => {
    const { distance, shift } = frameInView(10, SCREEN)
    expect(shift).toBe(0)
    // The sphere touches the top and bottom edges: the canvas is wider than tall.
    expect(distance).toBeCloseTo(10 / Math.sin((19 * Math.PI) / 180))
  })

  it('lands the centre in the middle of the room left of the panel', () => {
    const { distance, shift } = frameInView(10, WITH_SHEET)
    // The camera looks `shift` u right of the centre: the centre is that far left of the middle.
    expect(onScreen(-shift, distance, WITH_SHEET)).toBeCloseTo(996 / 2)
  })

  it('stands back further when the free room is narrower than tall', () => {
    const narrow: Viewport = { width: 1100, height: 900, inset: 444, fov: 38 }
    const { distance, shift } = frameInView(10, narrow)
    // The sphere touches the free room's sides, 656 px wide.
    const halfAcross = Math.atan((Math.tan((19 * Math.PI) / 180) * 656) / 900)
    expect(distance).toBeCloseTo(10 / Math.sin(halfAcross))
    expect(distance).toBeGreaterThan(frameInView(10, SCREEN).distance)
    expect(onScreen(-shift, distance, narrow)).toBeCloseTo(656 / 2)
  })
})

describe('revealShift', () => {
  it('leaves a selection clear of the panel', () => {
    expect(revealShift(400, 500, WITH_SHEET)).toBe(0)
    expect(revealShift(1100, 1200, SCREEN)).toBe(0)
  })

  it('slides a hidden selection just clear of the panel', () => {
    expect(revealShift(1100, 1200, WITH_SHEET)).toBe(1200 - 996 + 24)
  })

  it('slides one partly under the panel too', () => {
    expect(revealShift(950, 1050, WITH_SHEET)).toBe(1050 - 996 + 24)
  })

  it('leaves a selection off screen where it is', () => {
    expect(revealShift(1500, 1600, WITH_SHEET)).toBe(0)
  })

  it('brings one too wide to clear to the middle of the free room', () => {
    expect(revealShift(300, 1400, WITH_SHEET)).toBe(850 - 498)
  })
})

describe('turnAbout', () => {
  it('turns a point the way the azimuth grows, keeping its distance', () => {
    // At azimuth 0 the camera stands on +z of what it looks at; a quarter turn brings it to +x.
    const [x, z] = turnAbout([0, 1], [0, 0], Math.PI / 2)
    expect(x).toBeCloseTo(1)
    expect(z).toBeCloseTo(0)
  })

  it('turns about the centre given', () => {
    const [x, z] = turnAbout([13, 4], [10, 0], Math.PI)
    expect(x).toBeCloseTo(7)
    expect(z).toBeCloseTo(-4)
  })
})

describe('orbitTilt', () => {
  const polar = (55 * Math.PI) / 180
  const degrees = (radians: number) => (radians * 180) / Math.PI

  it('sets off from the tilt the camera flew in at', () => {
    expect(orbitTilt(polar, 0)).toBe(polar)
  })

  it('rises 14° at most, halfway through a swell, and comes back down', () => {
    expect(degrees(orbitTilt(polar, 15))).toBeCloseTo(41)
    expect(orbitTilt(polar, 30)).toBeCloseTo(polar)
    for (let second = 0; second < 60; second += 0.5) {
      expect(orbitTilt(polar, second)).toBeLessThanOrEqual(polar)
    }
  })

  it('stays off the vertical when the camera already looks almost straight down', () => {
    const steep = (10 * Math.PI) / 180
    expect(degrees(orbitTilt(steep, 15))).toBeCloseTo(5)
    expect(orbitTilt(0, 15)).toBe(0)
  })
})
