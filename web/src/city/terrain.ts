import { Mesh, ShapeUtils, Vector2 } from 'three'
import { FOAM_WIDTH, type IslandShape } from './island-shape'
import { MeshBuilder } from './mesh-builder'
import { groundMaterial } from './plateaux'
import { OPEN_SEA } from './sea'
import { mixSrgb, srgb, type Vec3 } from './units'

const PAVING = srgb('#EDE3CF')
const CLIFF = srgb('#D2AE84')
/** Terraces between the plateau and the beach, from the lowest to the highest. */
const GRASS = ['#A2C981', '#AED18A', '#B9D894', '#C3DE9E', '#CDE3A8', '#D6E8B2'].map(srgb)
const SAND = srgb('#F2E2BE')
const SAND_FLANK = mixSrgb('#F2E2BE', '#000000', 0.12)
const FOAM = mixSrgb(OPEN_SEA, '#FFFFFF', 0.4)
const WHITE = srgb('#FFFFFF')
/** The foam's white rim, at its outer edge. */
const FOAM_RIM = 0.12
/** Just above the sea, so that the foam never fights it for depth. */
const FOAM_ALTITUDE = 0.03

const UP: Vec3 = [0, 0, 1]

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
  const foam = ring(terraces, FOAM_WIDTH - FOAM_RIM)
  const rim = ring(terraces, FOAM_WIDTH)
  band(builder, inner, FOAM_ALTITUDE, foam, FOAM_ALTITUDE, FOAM, false)
  band(builder, foam, FOAM_ALTITUDE, rim, FOAM_ALTITUDE, WHITE, false)
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
  colour: Vec3,
  cliff: boolean,
): void {
  const count = from.length
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count
    const [ax, ay] = from[i] ?? [0, 0]
    const [bx, by] = from[j] ?? [0, 0]
    const [cx, cy] = to[j] ?? [0, 0]
    const [dx, dy] = to[i] ?? [0, 0]
    // Counter-clockwise outlines: the outside of a segment is to its right.
    const facing: Vec3 = cliff ? [by - ay, -(bx - ax), 0] : UP
    builder.quad([ax, ay, fromZ], [bx, by, fromZ], [cx, cy, toZ], [dx, dy, toZ], colour, facing)
  }
}
