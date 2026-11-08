import { Mesh } from 'three'
import type { Bridge, CityLinks, Quay } from './links'
import { MeshBuilder } from './render/mesh-builder'
import { BRIDGE_RAIL, BRIDGE_STONE, QUAY, UPWARD } from './render/palette'
import { groundMaterial } from './terrain/plateaux'
import { mixSrgb, srgb, type Vec3 } from './world/units'

// Bridges and quays, in one draw call: stone decks from plateau to plateau on square piers, and
// wooden piers (or a port's stone quay) from the beach out to the ferries.

const STONE = srgb(BRIDGE_STONE)
const STONE_FLANK = mixSrgb(BRIDGE_STONE, '#000000', 0.12)
const PILE = mixSrgb(BRIDGE_STONE, '#000000', 0.08)
const RAIL = srgb(BRIDGE_RAIL)
const RED = srgb(UPWARD)
const WOOD = srgb('#B98B5E')
const WOOD_SIDE = mixSrgb('#B98B5E', '#000000', 0.15)
const PORT_STONE = srgb(QUAY)
const PORT_SIDE = mixSrgb(QUAY, '#000000', 0.15)

const DECK_THICKNESS = 0.3
/** The deck's top stands this much above the plateau, and reaches this far onto it. */
const DECK_RISE = 0.08
const DECK_ANCHOR = 0.6
/** Railings: 0.18 u high, at 92 % of the half-width. */
const RAIL_HEIGHT = 0.18
const RAIL_WIDTH = 0.06
const RAIL_SHARE = 0.92
/** One pile every 5 u of span. */
const PILE_SPAN = 5
/** A link that goes up: a dashed red band along the deck. */
const BAND_WIDTH = 0.25
const BAND_DASH = [0.6, 0.5] as const
const BAND_RISE = 0.03
/** A quay's top, just above the beach (0.35 u). */
const QUAY_TOP = 0.42

/** Every bridge and quay of the city. */
export function createBridges(links: CityLinks): Mesh {
  const builder = new MeshBuilder()
  for (const bridge of links.bridges) {
    addBridge(builder, bridge)
  }
  for (const quay of links.quays) {
    addQuay(builder, quay)
  }
  const mesh = new Mesh(builder.build(), groundMaterial())
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/**
 * A frame along a bridge: `s` across the channel from the low bank, `t` across the deck from its
 * centre line, `z` up.
 */
function frame(bridge: Bridge) {
  return (s: number, t: number, z: number): Vec3 =>
    bridge.axis === 'x' ? [s, bridge.at + t, z] : [bridge.at + t, s, z]
}

/**
 * A line along a bridge's deck, from bank to bank, `t` across from its centre line and `rise`
 * above its top, in board coordinates (z up).
 */
export function deckLine(bridge: Bridge, t: number, rise: number): [Vec3, Vec3] {
  const at = frame(bridge)
  return [
    at(bridge.start - DECK_ANCHOR, t, bridge.startZ + DECK_RISE + rise),
    at(bridge.end + DECK_ANCHOR, t, bridge.endZ + DECK_RISE + rise),
  ]
}

export function addBridge(builder: MeshBuilder, bridge: Bridge): void {
  const at = frame(bridge)
  const s0 = bridge.start - DECK_ANCHOR
  const s1 = bridge.end + DECK_ANCHOR
  const z0 = bridge.startZ + DECK_RISE
  const z1 = bridge.endZ + DECK_RISE
  // The deck's top at a point of the span: a straight slope from bank to bank.
  const top = (s: number) => z0 + ((z1 - z0) * (s - s0)) / (s1 - s0)
  const half = bridge.width / 2
  const up: Vec3 = [0, 0, 1]
  const down: Vec3 = [0, 0, -1]
  const left: Vec3 = bridge.axis === 'x' ? [0, -1, 0] : [-1, 0, 0]
  const right: Vec3 = bridge.axis === 'x' ? [0, 1, 0] : [1, 0, 0]

  builder.quad(at(s0, -half, z0), at(s1, -half, z1), at(s1, half, z1), at(s0, half, z0), STONE, up)
  for (const [t, facing] of [
    [-half, left],
    [half, right],
  ] as const) {
    builder.quad(
      at(s0, t, z0 - DECK_THICKNESS),
      at(s1, t, z1 - DECK_THICKNESS),
      at(s1, t, z1),
      at(s0, t, z0),
      STONE_FLANK,
      facing,
    )
  }
  builder.quad(
    at(s0, -half, z0 - DECK_THICKNESS),
    at(s1, -half, z1 - DECK_THICKNESS),
    at(s1, half, z1 - DECK_THICKNESS),
    at(s0, half, z0 - DECK_THICKNESS),
    STONE_FLANK,
    down,
  )

  // Railings: a thin strip on each side, its top and both faces.
  for (const sign of [-1, 1]) {
    const t0 = sign * RAIL_SHARE * half - RAIL_WIDTH / 2
    const t1 = t0 + RAIL_WIDTH
    const h = RAIL_HEIGHT
    builder.quad(
      at(s0, t0, z0 + h),
      at(s1, t0, z1 + h),
      at(s1, t1, z1 + h),
      at(s0, t1, z0 + h),
      RAIL,
      up,
    )
    builder.quad(at(s0, t0, z0), at(s1, t0, z1), at(s1, t0, z1 + h), at(s0, t0, z0 + h), RAIL, left)
    builder.quad(
      at(s0, t1, z0),
      at(s1, t1, z1),
      at(s1, t1, z1 + h),
      at(s0, t1, z0 + h),
      RAIL,
      right,
    )
  }

  // Piles down to the sea, spread over the span.
  const span = bridge.end - bridge.start
  const piles = Math.floor(span / PILE_SPAN)
  const side = Math.min(0.9, 0.7 * bridge.width) / 2
  for (let k = 1; k <= piles; k++) {
    const s = bridge.start + (span * k) / (piles + 1)
    const z = top(s) - DECK_THICKNESS
    const corners = [
      [s - side, -side],
      [s + side, -side],
      [s + side, side],
      [s - side, side],
    ] as const
    corners.forEach(([sa, ta], index) => {
      const [sb, tb] = corners[(index + 1) % 4] ?? corners[0]
      // Away from the pile's axis, in board coordinates.
      const ds = (sa + sb) / 2 - s
      const dt = (ta + tb) / 2
      const out: Vec3 = bridge.axis === 'x' ? [ds, dt, 0] : [dt, ds, 0]
      builder.quad(at(sa, ta, 0), at(sb, tb, 0), at(sb, tb, z), at(sa, ta, z), PILE, out)
    })
  }

  if (bridge.upward) {
    const period = BAND_DASH[0] + BAND_DASH[1]
    const w = BAND_WIDTH / 2
    for (let s = s0 + BAND_DASH[1]; s + BAND_DASH[0] <= s1; s += period) {
      const e = s + BAND_DASH[0]
      builder.quad(
        at(s, -w, top(s) + BAND_RISE),
        at(e, -w, top(e) + BAND_RISE),
        at(e, w, top(e) + BAND_RISE),
        at(s, w, top(s) + BAND_RISE),
        RED,
        up,
      )
    }
  }
}

/** A pier or a port's quay: a box from up the beach out over the water. */
export function addQuay(builder: MeshBuilder, quay: Quay): void {
  const half = quay.width / 2
  const tipX = quay.x + quay.nx * quay.length
  const tipY = quay.y + quay.ny * quay.length
  const x0 = Math.min(quay.x, tipX) - Math.abs(quay.ny) * half
  const x1 = Math.max(quay.x, tipX) + Math.abs(quay.ny) * half
  const y0 = Math.min(quay.y, tipY) - Math.abs(quay.nx) * half
  const y1 = Math.max(quay.y, tipY) + Math.abs(quay.nx) * half
  builder.box(
    x0,
    y0,
    x1 - x0,
    y1 - y0,
    0,
    QUAY_TOP,
    quay.port ? PORT_STONE : WOOD,
    quay.port ? PORT_SIDE : WOOD_SIDE,
  )
}
