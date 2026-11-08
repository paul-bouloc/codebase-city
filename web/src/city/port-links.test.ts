import { describe, expect, it } from 'vitest'
import { badgeInView, portBadgeAt, portLabels, portRows } from './port-links'
import type { Port } from './waterways/links'

const PORT: Port = {
  island: 2,
  pairs: [
    { a: 2, b: 5, imports: 40, upward: false },
    { a: 1, b: 2, imports: 12, upward: false },
  ],
  quay: { island: 2, side: 'west', x: 10, y: 20, nx: -1, ny: 0, length: 3, width: 1.4, port: true },
}

describe('port links', () => {
  it('counts a port’s links on a badge over the end of its quay', () => {
    const [label] = portLabels([PORT])
    expect(label?.text).toBe('+2')
    // Board (7, 20) is three.js (7, rise, −20).
    expect(portBadgeAt(PORT)[0]).toBeCloseTo(7)
    expect(portBadgeAt(PORT)[2]).toBeCloseTo(-20)
    expect(portBadgeAt(PORT)[1]).toBeGreaterThan(0)
  })

  it('lists its links from its island’s side, the largest first, each way they go', () => {
    const rows = portRows(PORT, [
      { from: 2, to: 5, imports: 30, upward: 0 },
      { from: 5, to: 2, imports: 10, upward: 0 },
      { from: 1, to: 2, imports: 12, upward: 0 },
    ])
    expect(rows).toEqual([
      { island: 5, imports: 40, outgoing: true, incoming: true },
      { island: 1, imports: 12, outgoing: false, incoming: true },
    ])
  })

  it('keeps a badge in view while some of its pill is, its point below the view or not', () => {
    expect(badgeInView(100, 100, 800, 600)).toBe(true)
    // The point under the bottom edge, its pill above it still on screen.
    expect(badgeInView(100, 615, 800, 600)).toBe(true)
    expect(badgeInView(100, 640, 800, 600)).toBe(false)
    // The pill above the top edge.
    expect(badgeInView(100, 5, 800, 600)).toBe(false)
    // Half a pill past a side.
    expect(badgeInView(-10, 100, 800, 600)).toBe(true)
    expect(badgeInView(-30, 100, 800, 600)).toBe(false)
  })
})
