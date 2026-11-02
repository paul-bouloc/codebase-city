import { Mesh, ShapeUtils, Vector2 } from 'three'
import { type CanalCell, ISLAND_MARGIN, islandCanals, QUAY_WIDTH } from './canals'
import { FOAM_WIDTH, type IslandShape, type Side } from './island-shape'
import { MeshBuilder } from './mesh-builder'
import { groundMaterial } from './plateaux'
import { SHORE_BAND } from './sea'
import { mixSrgb, srgb, type Vec3 } from './units'

const PAVING = srgb('#EDE3CF')
const CLIFF = srgb('#D2AE84')
/** Terraces between the plateau and the beach, from the lowest to the highest. */
const GRASS = ['#A2C981', '#AED18A', '#B9D894', '#C3DE9E', '#CDE3A8', '#D6E8B2'].map(srgb)
const SAND = srgb('#F2E2BE')
const SAND_FLANK = mixSrgb('#F2E2BE', '#000000', 0.12)
// The design's `mix(sea, white, 40 %)`, from the shallow band the beach stands in: from the
// open sea, the foam came out darker than the water around it.
const FOAM = mixSrgb(SHORE_BAND, '#FFFFFF', 0.4)
const WHITE = srgb('#FFFFFF')
/** Just above the sea, which is drawn first and writes no depth. */
const FOAM_ALTITUDE = 0.02

const UP: Vec3 = [0, 0, 1]

const QUAY = srgb('#C9B894')
const WATER = srgb('#79BFC0')
const FALL = srgb('#DDF1F2')
const WOOD = srgb('#B98B5E')
const WOOD_SIDE = mixSrgb('#B98B5E', '#000000', 0.15)
/** Above the plateau, under the parcels' slabs (0.15 u): the quay, then the water on it. */
const QUAY_HEIGHT = 0.04
const WATER_HEIGHT = 0.07
/** A cascade's sheet, and how far it stands off the cliff it runs down. */
const FALL_WIDTH = 0.76
const FALL_OFFSET = 0.05
/** The foam pool at a cascade's foot. */
const POOL_WIDTH = 1.6
const POOL_LENGTH = 1.5
/** A footbridge's deck rests on both banks' slabs, just above them. */
const DECK_BOTTOM = 0.1
const DECK_TOP = 0.2
const DECK_OVERHANG = 0.1

/**
 * Every island's terrain in one draw call: the plateau's top, then down each terrace's cliff
 * and across its grass to the beach, its flank and the foam on the sea.
 */
export function createTerrain(shapes: readonly IslandShape[]): Mesh {
  const builder = new MeshBuilder()
  for (const shape of shapes) {
    addIsland(builder, shape)
  }
  const mesh = new Mesh(builder.build(), groundMaterial())
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** A frame on one side of the plateau: along it, out from its edge (negative inward), and up. */
function sideFrame(shape: IslandShape, side: Side) {
  const { x, y, width, height } = shape.island.plateau
  const frames: Record<
    Side,
    { origin: [number, number]; along: [number, number]; out: [number, number] }
  > = {
    south: { origin: [x, y], along: [1, 0], out: [0, -1] },
    east: { origin: [x + width, y], along: [0, 1], out: [1, 0] },
    north: { origin: [x + width, y + height], along: [-1, 0], out: [0, 1] },
    west: { origin: [x, y + height], along: [0, -1], out: [-1, 0] },
  }
  const { origin, along, out } = frames[side]
  return {
    out,
    /** A point `a` along the side and `o` out of the plateau's edge, at height `z`. */
    point: (a: number, o: number, z: number): Vec3 => [
      origin[0] + along[0] * a + out[0] * o,
      origin[1] + along[1] * a + out[1] * o,
      z,
    ],
    /** Where a board point falls along the side. */
    alongOf: (px: number, py: number) => (px - origin[0]) * along[0] + (py - origin[1]) * along[1],
  }
}

/** A flat quad over a rectangle. */
function flat(
  builder: MeshBuilder,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  z: number,
  colour: Vec3,
) {
  builder.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], colour, UP)
}

/** Quays and water in every canal, a cascade at each mouth, a footbridge over long ones. */
function addCanals(builder: MeshBuilder, shape: IslandShape): void {
  const { cells, footbridges } = islandCanals(shape.island)
  const plateau = shape.altitudes[0] ?? 0
  for (const cell of cells) {
    const { x, y, width, height } = cell.rect
    flat(builder, x, y, x + width, y + height, plateau + QUAY_HEIGHT, QUAY)
    const inset = (side: Side) => (cell.quays[side] ? QUAY_WIDTH : 0)
    flat(
      builder,
      x + inset('west'),
      y + inset('south'),
      x + width - inset('east'),
      y + height - inset('north'),
      plateau + WATER_HEIGHT,
      WATER,
    )
    if (cell.mouth) {
      addMouth(builder, shape, cell, cell.mouth)
    }
  }
  for (const { rect } of footbridges) {
    const alongX = rect.width > rect.height
    builder.box(
      rect.x - (alongX ? DECK_OVERHANG : 0),
      rect.y - (alongX ? 0 : DECK_OVERHANG),
      rect.width + (alongX ? 2 * DECK_OVERHANG : 0),
      rect.height + (alongX ? 0 : 2 * DECK_OVERHANG),
      plateau + DECK_BOTTOM,
      plateau + DECK_TOP,
      WOOD,
      WOOD_SIDE,
    )
  }
}

/** The canal runs on through the margin to the plateau's edge, then falls terrace by terrace. */
function addMouth(builder: MeshBuilder, shape: IslandShape, cell: CanalCell, side: Side): void {
  const frame = sideFrame(shape, side)
  const { x, y, width, height } = cell.rect
  const [a0, a1] = [frame.alongOf(x, y), frame.alongOf(x + width, y + height)].sort(
    (p, q) => p - q,
  ) as [number, number]
  // A canal reaches the margin between two folders: a quay on each bank.
  const water0 = a0 + QUAY_WIDTH
  const water1 = a1 - QUAY_WIDTH
  const middle = (a0 + a1) / 2
  const offsets = shape.offsetsAt(side, middle)
  const edge = offsets[0] ?? 0
  const plateau = shape.altitudes[0] ?? 0
  const outward: Vec3 = [frame.out[0], frame.out[1], 0]
  const strip = (from: number, to: number, o0: number, o1: number, z: number, colour: Vec3) =>
    builder.quad(
      frame.point(from, o0, z),
      frame.point(to, o0, z),
      frame.point(to, o1, z),
      frame.point(from, o1, z),
      colour,
      UP,
    )

  strip(a0, a1, -ISLAND_MARGIN, edge, plateau + QUAY_HEIGHT, QUAY)
  strip(water0, water1, -ISLAND_MARGIN, edge + FALL_OFFSET, plateau + WATER_HEIGHT, WATER)

  const f0 = middle - FALL_WIDTH / 2
  const f1 = middle + FALL_WIDTH / 2
  const wall = (o: number, top: number, bottom: number) =>
    builder.quad(
      frame.point(f0, o, top),
      frame.point(f1, o, top),
      frame.point(f1, o, bottom),
      frame.point(f0, o, bottom),
      FALL,
      outward,
    )
  let top = plateau + WATER_HEIGHT
  for (let ring = 1; ring < shape.altitudes.length; ring++) {
    const inner = (offsets[ring - 1] ?? 0) + FALL_OFFSET
    const outer = offsets[ring] ?? inner
    const landing = (shape.altitudes[ring] ?? 0) + FALL_OFFSET
    wall(inner, top, landing)
    strip(f0, f1, inner, outer + FALL_OFFSET, landing, WATER)
    top = landing
  }
  // Off the beach into a pool of foam.
  const beach = (offsets.at(-1) ?? 0) + FALL_OFFSET
  wall(beach, top, 0)
  strip(
    middle - POOL_WIDTH / 2,
    middle + POOL_WIDTH / 2,
    beach,
    beach + POOL_LENGTH,
    FOAM_ALTITUDE + 0.02,
    FOAM,
  )
}

function addIsland(builder: MeshBuilder, shape: IslandShape): void {
  const { samples, altitudes } = shape
  const terraces = altitudes.length - 1
  const ring = (index: number, extra = 0): [number, number][] =>
    samples.map((sample) => {
      const offset = (sample.offsets[index] ?? 0) + extra
      return [sample.x + sample.nx * offset, sample.y + sample.ny * offset]
    })

  // The plateau's top: an outline that may be concave, so earcut rather than a fan.
  const plateau = altitudes[0] ?? 0
  const edge = ring(0)
  const outline = edge.map(([x, y]) => new Vector2(x, y))
  for (const [a, b, c] of ShapeUtils.triangulateShape(outline, [])) {
    const corner = (index: number | undefined): Vec3 => {
      const [x, y] = edge[index ?? 0] ?? [0, 0]
      return [x, y, plateau]
    }
    builder.triangle(corner(a), corner(b), corner(c), PAVING, UP)
  }

  let inner = edge
  for (let terrace = 1; terrace <= terraces; terrace++) {
    const above = altitudes[terrace - 1] ?? 0
    const top = altitudes[terrace] ?? 0
    const outer = ring(terrace)
    const grass = terrace === terraces ? SAND : (GRASS[terraces - 1 - terrace] ?? SAND)
    band(builder, inner, above, inner, top, CLIFF, true)
    band(builder, inner, top, outer, top, grass, false)
    inner = outer
  }
  // The beach's flank down to the sea, then the foam around it.
  band(builder, inner, altitudes[terraces] ?? 0, inner, 0, SAND_FLANK, true)
  // Whitening outward: a thin white rim would shimmer once it is under a pixel wide.
  const rim = ring(terraces, FOAM_WIDTH)
  band(builder, inner, FOAM_ALTITUDE, rim, FOAM_ALTITUDE, [FOAM, WHITE], false)
  addCanals(builder, shape)
}

/**
 * Quads between two rings, sample by sample: a cliff when both rings are the same outline at
 * two heights, a flat strip when they are two outlines at one height.
 */
function band(
  builder: MeshBuilder,
  from: [number, number][],
  fromZ: number,
  to: [number, number][],
  toZ: number,
  colour: Vec3 | [inner: Vec3, outer: Vec3],
  cliff: boolean,
): void {
  const [fromColour, toColour] = colour.length === 2 ? colour : [colour, colour]
  const count = from.length
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count
    const [ax, ay] = from[i] ?? [0, 0]
    const [bx, by] = from[j] ?? [0, 0]
    const [cx, cy] = to[j] ?? [0, 0]
    const [dx, dy] = to[i] ?? [0, 0]
    // Counter-clockwise outlines: the outside of a segment is to its right.
    const facing: Vec3 = cliff ? [by - ay, -(bx - ax), 0] : UP
    builder.quad(
      [ax, ay, fromZ],
      [bx, by, fromZ],
      [cx, cy, toZ],
      [dx, dy, toZ],
      [fromColour, fromColour, toColour, toColour],
      facing,
    )
  }
}
