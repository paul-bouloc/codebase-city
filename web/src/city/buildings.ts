import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshDepthMaterial,
  ShaderMaterial,
} from 'three'
import { archetypeGeometry, type Vertex } from './archetype-geometry'
import { ARCHETYPES, type Archetype, type Building, buildingFor } from './archetypes'
import type { BuildingLanguage, CityLayout } from './layout'
import { shadingFragmentPars, shadingUniforms, shadingVertex, shadingVertexPars } from './shading'
import { boardToThree, layerAltitude, srgb, type Vec3 } from './units'

// TypeScript, JavaScript and CSS are tuned by hand; the others take their GitHub Linguist colour.
const LANGUAGE_COLOURS: Record<BuildingLanguage, Vec3> = {
  typescript: srgb('#5A8EDB'),
  javascript: srgb('#E2B23A'),
  css: srgb('#B57BD0'),
  python: srgb('#3572A5'),
  go: srgb('#00ADD8'),
  other: srgb('#B9AE9C'),
}
const TEST_COLOUR = srgb('#CFC7B8')
/** Edges are `mix(language, black, 42 %)`, on every part of the building, never shaded. */
const EDGE_DARKENING = 0.42
/** Line width each face draws inside its outline, in CSS pixels: two faces make a 0.5 px edge. */
const EDGE_WIDTH = 0.25

// Each vertex is its fixed part plus what follows the instance's side, height and split.
const stretchPars = /* glsl */ `
attribute vec3 sideFactor;
attribute vec2 heightFactor;
attribute vec3 building;
`
const stretchVertex = /* glsl */ `
vec3 transformed = position + sideFactor * building.x;
transformed.y += dot(heightFactor, building.yz);
`
const BEGIN_VERTEX = '#include <begin_vertex>'

const vertexShader = /* glsl */ `
${shadingVertexPars}
${stretchPars}
attribute vec4 paint;
attribute vec3 tint;
attribute vec3 edge;
varying vec3 vColor;
varying vec3 vEdge;
varying vec3 vEdgeColor;
void main() {
  vColor = mix(tint, paint.rgb, paint.a);
  vEdge = edge;
  vEdgeColor = tint * ${(1 - EDGE_DARKENING).toFixed(6)};
  ${shadingVertex.replace(BEGIN_VERTEX, stretchVertex)}
}
`

const fragmentShader = /* glsl */ `
${shadingFragmentPars}
uniform float edgeWidth;
varying vec3 vColor;
varying vec3 vEdge;
varying vec3 vEdgeColor;
void main() {
  // Distance to each side in pixels; a side without a line stays far away.
  vec3 perPixel = sqrt(dFdx(vEdge) * dFdx(vEdge) + dFdy(vEdge) * dFdy(vEdge));
  vec3 toSide = vEdge / max(perPixel, 1e-6);
  float d = min(min(toSide.x, toSide.y), toSide.z);
  // The share of this pixel covered by the line: a sub-pixel line is a lighter pixel.
  float cover = clamp(min(edgeWidth, d + 0.5) - max(0.0, d - 0.5), 0.0, 1.0);
  gl_FragColor = vec4(mix(shade(vColor, normalize(vWorldNormal)), vEdgeColor, cover), 1.0);
}
`

/** The shadow pass must stretch the vertices too, or shadows keep the unstretched shape. */
function stretchedDepthMaterial(): MeshDepthMaterial {
  const material = new MeshDepthMaterial()
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = stretchPars + shader.vertexShader.replace(BEGIN_VERTEX, stretchVertex)
  }
  material.customProgramCacheKey = () => 'city-building-depth'
  return material
}

const VERTEX_ATTRIBUTES = [
  'position',
  'sideFactor',
  'heightFactor',
  'normal',
  'paint',
  'edge',
] as const satisfies readonly (keyof Vertex)[]

interface Placed {
  building: Building
  position: Vec3
  tint: Vec3
}

/** Every building, in one instanced draw call per archetype; edges are sized for `pixelRatio`. */
export function createBuildings(layout: CityLayout, pixelRatio: number): Group {
  const byArchetype = new Map<Archetype, Placed[]>()
  for (const island of layout.islands) {
    const altitude = layerAltitude(island.layer)
    for (const lot of island.lots) {
      const building = buildingFor(lot.file)
      const placed = byArchetype.get(building.archetype) ?? []
      placed.push({
        building,
        position: boardToThree(lot.x, lot.y, altitude + (lot.base ?? 0)),
        tint: lot.file.test ? TEST_COLOUR : LANGUAGE_COLOURS[lot.file.language],
      })
      byArchetype.set(building.archetype, placed)
    }
  }

  const group = new Group()
  for (const archetype of ARCHETYPES) {
    const placed = byArchetype.get(archetype)
    if (placed) {
      group.add(instancedArchetype(archetype, placed, EDGE_WIDTH * pixelRatio))
    }
  }
  return group
}

function instancedArchetype(
  archetype: Archetype,
  placed: Placed[],
  edgeWidth: number,
): InstancedMesh {
  const vertices = archetypeGeometry(archetype).flat()
  const geometry = new BufferGeometry()
  for (const name of VERTEX_ATTRIBUTES) {
    const values = vertices.flatMap((vertex) => vertex[name])
    geometry.setAttribute(name, new Float32BufferAttribute(values, values.length / vertices.length))
  }

  const sizes = new Float32Array(placed.length * 3)
  const tints = new Float32Array(placed.length * 3)
  const material = new ShaderMaterial({
    uniforms: { ...shadingUniforms(), edgeWidth: { value: edgeWidth } },
    vertexShader,
    fragmentShader,
    lights: true,
  })
  const mesh = new InstancedMesh(geometry, material, placed.length)
  const matrix = new Matrix4()
  placed.forEach(({ building, position, tint }, index) => {
    mesh.setMatrixAt(index, matrix.makeTranslation(...position))
    sizes.set([building.side, building.height, building.split], index * 3)
    tints.set(tint, index * 3)
  })
  geometry.setAttribute('building', new InstancedBufferAttribute(sizes, 3))
  geometry.setAttribute('tint', new InstancedBufferAttribute(tints, 3))

  mesh.customDepthMaterial = stretchedDepthMaterial()
  mesh.castShadow = true
  mesh.receiveShadow = true
  // The shader moves the vertices: three.js cannot bound them, and the city is one whole anyway.
  mesh.frustumCulled = false
  return mesh
}
