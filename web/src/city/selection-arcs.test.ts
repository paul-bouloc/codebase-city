import { describe, expect, it } from 'vitest'
import { ARC_SEGMENTS } from './arc-path'
import { INCOMING_LINK, OUTGOING_LINK, UPWARD } from './palette'
import { bundleWidth, HUB_RISE, selectionArcs } from './selection-arcs'
import type { LinkEnd, Linked, SelectionLinks } from './selection-links'
import { srgb, type Vec3 } from './world/units'

const linked = (building: number, island: number, upward = false): Linked => ({
  end: { building },
  island,
  upward,
})
// Building n stands at x = n, on the ground.
const place = (end: LinkEnd): Vec3 => ('building' in end ? [end.building, 0, 0] : [0, 0, 0])
const plateau = (island: number) => island + 1

describe('selectionArcs', () => {
  const links: SelectionLinks = {
    outgoing: {
      single: [linked(10, 0), linked(20, 1, true)],
      bundles: [{ direction: 'outgoing', island: 2, ends: [linked(30, 2), linked(50, 2)] }],
    },
    incoming: { single: [linked(-10, 0)], bundles: [] },
  }
  const selection: Vec3 = [0, 1, 0]
  const { drawing, hubs } = selectionArcs(links, selection, {
    arcEnd: place,
    ground: place,
    plateau,
  })

  it('draws imports from the selection in Marine, importers to it in Sun, upward in red', () => {
    expect(drawing.lines.map((line) => line.colour)).toEqual([
      srgb(OUTGOING_LINK),
      srgb(UPWARD),
      srgb(OUTGOING_LINK),
      srgb(INCOMING_LINK),
    ])
    const [imported, , , importer] = drawing.lines
    expect(imported?.points[0]).toEqual(selection)
    expect(imported?.points[ARC_SEGMENTS]?.[0]).toBeCloseTo(10)
    expect(importer?.points[0]).toEqual([-10, 0, 0])
    expect(importer?.points[ARC_SEGMENTS]).toEqual(selection)
    expect(drawing.lines[1]?.upward).toBe(true)
  })

  it('gathers a bundle at a hub over its files, its width and count growing with them', () => {
    expect(hubs).toHaveLength(1)
    expect(hubs[0]?.position).toEqual([40, 3 + HUB_RISE, 0])
    expect(drawing.lines[2]?.width).toBeCloseTo(bundleWidth(2))
    expect(bundleWidth(1)).toBe(2)
    expect(bundleWidth(100)).toBeCloseTo(4.8)
    expect(drawing.labels).toEqual([
      { position: [40, 7, 0], text: '2 files', colour: srgb(OUTGOING_LINK) },
    ])
    expect(drawing.stems).toEqual([
      {
        colour: srgb(OUTGOING_LINK),
        polylines: [
          [
            [40, 7, 0],
            [40, 3, 0],
          ],
        ],
      },
    ])
  })

  it('counts a lone file in the singular', () => {
    const lone: SelectionLinks = {
      outgoing: {
        single: [],
        bundles: [{ direction: 'outgoing', island: 0, ends: [linked(1, 0)] }],
      },
      incoming: { single: [], bundles: [] },
    }
    const arcs = selectionArcs(lone, selection, { arcEnd: place, ground: place, plateau })
    expect(arcs.drawing.labels[0]?.text).toBe('1 file')
  })

  it('counts what is left of an opened bundle as more', () => {
    const left: SelectionLinks = {
      outgoing: {
        single: [],
        bundles: [{ direction: 'outgoing', island: 0, ends: [linked(1, 0)], shown: 50 }],
      },
      incoming: { single: [], bundles: [] },
    }
    const arcs = selectionArcs(left, selection, { arcEnd: place, ground: place, plateau })
    expect(arcs.drawing.labels[0]?.text).toBe('1 more')
  })

  it('grows the arcs just opened out of the selection', () => {
    const imported = linked(10, 0)
    const importer = linked(-10, 0)
    const opened: SelectionLinks = {
      outgoing: { single: [imported, linked(20, 0)], bundles: [] },
      incoming: { single: [importer], bundles: [] },
    }
    const arcs = selectionArcs(
      opened,
      selection,
      { arcEnd: place, ground: place, plateau },
      new Set([imported, importer]),
    )
    // From their start when the selection imports, from their end when it is imported
    expect(arcs.drawing.lines.map((line) => line.grows)).toEqual([1, undefined, -1])
  })

  it('puts a dot at each end of an arc, and two white ones along an upward arc', () => {
    // One at the far end of each arc, one of each kind at the selection, two on the upward arc
    expect(drawing.dots).toHaveLength(4 + 2 + 2)
    expect(drawing.dots.filter((dot) => dot.position === selection)).toHaveLength(2)
    const white = drawing.dots.filter((dot) => dot.colour.every((channel) => channel === 1))
    expect(white).toHaveLength(2)
  })

  it('draws the loop of its cycle in solid red, in place of the arcs along it', () => {
    // Selection 0 imports 10, which imports -10, which imports 0: one way round. 20 is a
    // member off the loop.
    const around: SelectionLinks = {
      outgoing: { single: [linked(10, 0), linked(5, 0)], bundles: [] },
      incoming: { single: [linked(-10, 0)], bundles: [] },
    }
    const arcs = selectionArcs(
      around,
      selection,
      { arcEnd: place, ground: place, plateau },
      new Set(),
      { loop: [0, 10, -10], members: [0, 10, -10, 20] },
    )
    const red = arcs.drawing.lines.filter((line) => line.solid)
    expect(red).toHaveLength(3)
    expect(red.map((line) => [line.colour, line.upward])).toEqual(
      Array(3).fill([srgb(UPWARD), false]),
    )
    expect(red[0]?.points[0]).toEqual(selection)
    expect(red[0]?.points[ARC_SEGMENTS]?.[0]).toBeCloseTo(10)
    expect(red[2]?.points[ARC_SEGMENTS]).toEqual(selection)
    // Only the link off the loop keeps its own arc
    const own = arcs.drawing.lines.filter((line) => !line.solid)
    expect(own).toHaveLength(1)
    expect(own[0]?.points[ARC_SEGMENTS]?.[0]).toBeCloseTo(5)
    expect(arcs.drawing.labels).toEqual([
      { position: [5, HUB_RISE, 0], text: 'Cycle · 4 files', colour: srgb(UPWARD), rimmed: true },
    ])
  })

  it('parts the two ways of a loop between two files', () => {
    const both: SelectionLinks = {
      outgoing: { single: [linked(10, 0)], bundles: [] },
      incoming: { single: [linked(10, 0)], bundles: [] },
    }
    const arcs = selectionArcs(
      both,
      [0, 0, 0],
      { arcEnd: place, ground: place, plateau },
      new Set(),
      { loop: [0, 10], members: [0, 10] },
    )
    expect(arcs.drawing.lines).toHaveLength(2)
    const middle = ARC_SEGMENTS / 2
    const [there, back] = arcs.drawing.lines.map((line) => line.points[middle] ?? [0, 0, 0])
    // Both upright, the way back higher
    expect(there?.[2]).toBe(0)
    expect(back?.[2]).toBe(0)
    expect(back?.[1] ?? 0).toBeGreaterThan((there?.[1] ?? 0) + 2)
  })
})
