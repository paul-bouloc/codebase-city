import { Mesh, ShaderMaterial } from 'three'
import type { Garden } from './gardens'
import type { CityLayout, ParcelLayout, ParcelNature, Rect } from './layout'
import { MeshBuilder } from './mesh-builder'
import { shadingFragmentPars, shadingUniforms, shadingVertex, shadingVertexPars } from './shading'
import { layerAltitude, mixSrgb, slabTop, srgb, type Vec3 } from './units'

export const PAVING = srgb('#EDE3CF')
const MEADOW = srgb('#C5DFA4')
const MEADOW_EDGE = srgb('#A9C58A')
const INNER_MEADOW = srgb('#D3E8B6')
const INNER_MEADOW_EDGE = srgb('#B9D49D')
const TEST_PARK = srgb('#B3D58B')
const TEST_PARK_EDGE = srgb('#93BC6E')
const CONCRETE = srgb('#D9D5CC')
/** Edges of a top are `mix(top, black, 12 %)`. */
const CONCRETE_EDGE = mixSrgb('#D9D5CC', '#000000', 0.12)
const PAVING_EDGE = mixSrgb('#EDE3CF', '#000000', 0.12)

const vertexShader = /* glsl */ `
${shadingVertexPars}
varying vec3 vColor;
void main() {
  vColor = color;
  ${shadingVertex}
}
`

const fragmentShader = /* glsl */ `
${shadingFragmentPars}
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(shade(vColor, normalize(vWorldNormal)), 1.0);
}
`

interface Block {
  rect: Rect
  /** 0 for square corners. */
  radius: number
  bottom: number
  top: number
  topColour: Vec3
  sideColour: Vec3
}

/**
 * Every parcel as a flat slab on its island, nested ones higher, in one draw call. Each slab
 * starts on the one it stands on: a nested slab flush with its parent's edge would otherwise
 * share its side, and flicker. The island's folders keep square corners, like the canals and
 * quays along them; the ones inside are rounded, along their streets. The square of an island
 * folder whose own files are not ordinary code gets a slab of their nature too.
 */
export function createParcels(layout: CityLayout, gardens: readonly Garden[] = []): Mesh {
  return blocksMesh([
    ...layout.islands.flatMap(({ parcels, grids = [], square, layer }) => {
      const altitude = layerAltitude(layer)
      const squareNature = grids.find((grid) => grid.square)?.nature ?? 'normal'
      const slabs: readonly ParcelLayout[] =
        square && squareNature !== 'normal'
          ? [...parcels, { rect: square, level: 1, nature: squareNature }]
          : parcels
      return slabs.map(({ rect, level, nature, paved }) => {
        const [topColour, sideColour] = paved ? [PAVING, PAVING_EDGE] : parcelColours(nature, level)
        return {
          rect,
          radius: level <= 1 ? 0 : CORNER_RADIUS,
          bottom: altitude + slabTop(level - 1),
          top: altitude + slabTop(level),
          topColour,
          sideColour,
        }
      })
    }),
    // Gardens are meadows, rounded: no canal runs along them.
    ...gardens.map(({ rect, bottom, top }) => ({
      rect,
      radius: CORNER_RADIUS,
      bottom,
      top,
      topColour: MEADOW,
      sideColour: MEADOW_EDGE,
    })),
  ])
}

function parcelColours(nature: ParcelNature, level: number): [Vec3, Vec3] {
  switch (nature) {
    case 'tests':
      return [TEST_PARK, TEST_PARK_EDGE]
    case 'unanalyzed':
      return [CONCRETE, CONCRETE_EDGE]
    case 'normal':
      return level <= 1 ? [MEADOW, MEADOW_EDGE] : [INNER_MEADOW, INNER_MEADOW_EDGE]
  }
}

/** Parcels have rounded corners: 0.7 u, or less on a narrow one. */
const CORNER_RADIUS = 0.7
/** Points inside each rounded corner, between its two ends. */
const CORNER_STEPS = 2

/**
 * A rectangle's outline with rounded corners, counter-clockwise: each corner a few chords of
 * its arc, always inside the rectangle.
 */
export function roundedOutline(rect: Rect, radius = CORNER_RADIUS): [number, number][] {
  const r = Math.min(radius, rect.width / 2, rect.height / 2)
  if (r <= 0) {
    const { x, y, width, height } = rect
    return [
      [x, y],
      [x + width, y],
      [x + width, y + height],
      [x, y + height],
    ]
  }
  const x0 = rect.x + r
  const x1 = rect.x + rect.width - r
  const y0 = rect.y + r
  const y1 = rect.y + rect.height - r
  const corners: [number, number, number][] = [
    [x1, y0, -Math.PI / 2],
    [x1, y1, 0],
    [x0, y1, Math.PI / 2],
    [x0, y0, Math.PI],
  ]
  return corners.flatMap(([cx, cy, start]) =>
    Array.from({ length: CORNER_STEPS + 1 }, (_, step): [number, number] => {
      const angle = start + (Math.PI / 2) * (step / CORNER_STEPS)
      return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)]
    }),
  )
}

function blocksMesh(blocks: Block[]): Mesh {
  const builder = new MeshBuilder()
  for (const { rect, radius, bottom, top, topColour, sideColour } of blocks) {
    const outline = roundedOutline(rect, radius)
    const cx = rect.x + rect.width / 2
    const cy = rect.y + rect.height / 2
    outline.forEach(([ax, ay], index) => {
      const [bx, by] = outline[(index + 1) % outline.length] ?? [ax, ay]
      builder.triangle([cx, cy, top], [ax, ay, top], [bx, by, top], topColour, [0, 0, 1])
      builder.quad([ax, ay, bottom], [bx, by, bottom], [bx, by, top], [ax, ay, top], sideColour, [
        by - ay,
        -(bx - ax),
        0,
      ])
    })
  }
  const mesh = new Mesh(builder.build(), groundMaterial())
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** Flat colours from the vertices, shaded like the rest of the city. */
export function groundMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: shadingUniforms(),
    vertexShader,
    fragmentShader,
    lights: true,
    vertexColors: true,
  })
}
