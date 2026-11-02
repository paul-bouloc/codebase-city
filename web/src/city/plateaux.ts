import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Mesh, ShaderMaterial } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { CityLayout, ParcelNature, Rect } from './layout'
import { shadingFragmentPars, shadingUniforms, shadingVertex, shadingVertexPars } from './shading'
import { boardToThree, layerAltitude, mixSrgb, slabTop, srgb, type Vec3 } from './units'

const PAVING = srgb('#EDE3CF')
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
  bottom: number
  top: number
  topColour: Vec3
  sideColour: Vec3
}

/** Every parcel as a flat slab on its island, nested ones higher, in one draw call. */
export function createParcels(layout: CityLayout): Mesh {
  return blocksMesh(
    layout.islands.flatMap(({ parcels, layer }) => {
      const altitude = layerAltitude(layer)
      return parcels.map(({ rect, level, nature, paved }) => {
        const [topColour, sideColour] = paved ? [PAVING, PAVING_EDGE] : parcelColours(nature, level)
        return { rect, bottom: altitude, top: altitude + slabTop(level), topColour, sideColour }
      })
    }),
  )
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

function blocksMesh(blocks: Block[]): Mesh {
  const geometries = blocks.map(({ rect, bottom, top, topColour, sideColour }) => {
    const [x, y, z] = boardToThree(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      (bottom + top) / 2,
    )
    const block = new BoxGeometry(rect.width, top - bottom, rect.height).translate(x, y, z)
    paint(block, topColour, sideColour)
    return block
  })
  // An empty city has no plateau: mergeGeometries cannot merge nothing.
  const geometry = geometries.length > 0 ? mergeGeometries(geometries) : new BufferGeometry()
  for (const block of geometries) {
    block.dispose()
  }
  const mesh = new Mesh(geometry, groundMaterial())
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

/** One colour on top, another on the sides. */
function paint(geometry: BufferGeometry, top: Vec3, side: Vec3) {
  const normals = geometry.getAttribute('normal')
  const colors = new Float32Array(normals.count * 3)
  for (let i = 0; i < normals.count; i++) {
    colors.set(normals.getY(i) > 0.5 ? top : side, i * 3)
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
}
