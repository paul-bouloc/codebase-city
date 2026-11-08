import { describe, expect, it } from 'vitest'
import { addBridge, addQuay } from './bridges'
import type { Bridge } from './links'
import { MeshBuilder } from './render/mesh-builder'

const BRIDGE: Bridge = {
  a: 0,
  b: 1,
  imports: 30,
  upward: false,
  axis: 'x',
  low: 0,
  high: 1,
  at: 10,
  start: 30,
  end: 42,
  startZ: 1.05,
  endZ: 1.5,
  width: 1.94,
}

/** The board coordinates (x, y, z) of every vertex; three.js has y up and z toward the south. */
function vertices(builder: MeshBuilder): [number, number, number][] {
  const positions = builder.build().getAttribute('position')
  return Array.from({ length: positions.count }, (_, i) => [
    positions.getX(i),
    -positions.getZ(i),
    positions.getY(i),
  ])
}

describe('addBridge', () => {
  it('spans from plateau to plateau in about 20 triangles, plus a pile per 5 u', () => {
    const builder = new MeshBuilder()
    addBridge(builder, BRIDGE)
    // Deck 8, railings 12, two piles of 8 (12 u of span)
    expect(builder.triangles).toBe(8 + 12 + 2 * 8)
    const points = vertices(builder)
    const xs = points.map(([x]) => x)
    const ys = points.map(([, y]) => y)
    expect(Math.min(...xs)).toBeCloseTo(30 - 0.6)
    expect(Math.max(...xs)).toBeCloseTo(42 + 0.6)
    expect(Math.min(...ys)).toBeCloseTo(10 - 0.97)
    expect(Math.max(...ys)).toBeCloseTo(10 + 0.97)
    // Piles stand on the sea; the deck rises from one plateau to the other.
    expect(Math.min(...points.map(([, , z]) => z))).toBe(0)
    expect(Math.max(...points.map(([, , z]) => z))).toBeCloseTo(1.5 + 0.08 + 0.18)
  })

  it('runs a dashed red band along a deck that carries a link up', () => {
    const plain = new MeshBuilder()
    addBridge(plain, BRIDGE)
    const red = new MeshBuilder()
    addBridge(red, { ...BRIDGE, upward: true })
    // 13.2 u of deck, a dash every 1.1 u
    expect(red.triangles - plain.triangles).toBe(2 * 11)
  })

  it('turns with a south-north bridge', () => {
    const builder = new MeshBuilder()
    addBridge(builder, { ...BRIDGE, axis: 'y' })
    const xs = vertices(builder).map(([x]) => x)
    expect(Math.min(...xs)).toBeCloseTo(10 - 0.97)
  })
})

describe('addQuay', () => {
  it('reaches from its root out along its side', () => {
    const builder = new MeshBuilder()
    addQuay(builder, {
      island: 0,
      side: 'west',
      x: -3,
      y: 5,
      nx: -1,
      ny: 0,
      length: 3.2,
      width: 0.6,
      port: false,
    })
    const points = vertices(builder)
    expect(Math.min(...points.map(([x]) => x))).toBeCloseTo(-6.2)
    expect(Math.max(...points.map(([x]) => x))).toBeCloseTo(-3)
    expect(Math.max(...points.map(([, y]) => y))).toBeCloseTo(5.3)
  })
})
