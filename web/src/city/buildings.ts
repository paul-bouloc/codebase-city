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
import type { Language } from '../ui/Badge'
import { archetypeGeometry, type Vertex } from './archetype-geometry'
import { ARCHETYPES, type Archetype, type Building, buildingFor } from './archetypes'
import type { CityLayout } from './layout'
import { shadingFragmentPars, shadingUniforms, shadingVertex, shadingVertexPars } from './shading'
import { boardToThree, layerAltitude, srgb, type Vec3 } from './units'

const LANGUAGE_COLOURS: Record<Language, Vec3> = {
  typescript: srgb('#5A8EDB'),
  javascript: srgb('#E2B23A'),
  css: srgb('#B57BD0'),
  other: srgb('#B9AE9C'),
}
const TEST_COLOUR = srgb('#CFC7B8')

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
varying vec3 vColor;
void main() {
  vColor = mix(tint, paint.rgb, paint.a);
  ${shadingVertex.replace(BEGIN_VERTEX, stretchVertex)}
}
`

const fragmentShader = /* glsl */ `
${shadingFragmentPars}
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(shade(vColor, normalize(vWorldNormal)), 1.0);
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

interface Placed {
  building: Building
  position: Vec3
  tint: Vec3
}

/** Every building, in one instanced draw call per archetype. */
export function createBuildings(layout: CityLayout): Group {
  const byArchetype = new Map<Archetype, Placed[]>()
  for (const island of layout.islands) {
    const altitude = layerAltitude(island.layer)
    for (const lot of island.lots) {
      const building = buildingFor(lot.file)
      const placed = byArchetype.get(building.archetype) ?? []
      placed.push({
        building,
        position: boardToThree(lot.x, lot.y, altitude),
        tint: lot.file.test ? TEST_COLOUR : LANGUAGE_COLOURS[lot.file.language],
      })
      byArchetype.set(building.archetype, placed)
    }
  }

  const group = new Group()
  for (const archetype of ARCHETYPES) {
    const placed = byArchetype.get(archetype)
    if (placed) {
      group.add(instancedArchetype(archetype, placed))
    }
  }
  return group
}

function instancedArchetype(archetype: Archetype, placed: Placed[]): InstancedMesh {
  const vertices = archetypeGeometry(archetype).flat()
  const geometry = new BufferGeometry()
  const attribute = (values: (vertex: Vertex) => number[], size: number) =>
    new Float32BufferAttribute(vertices.flatMap(values), size)
  geometry.setAttribute(
    'position',
    attribute((vertex) => vertex.position, 3),
  )
  geometry.setAttribute(
    'sideFactor',
    attribute((vertex) => vertex.sideFactor, 3),
  )
  geometry.setAttribute(
    'heightFactor',
    attribute((vertex) => vertex.heightFactor, 2),
  )
  geometry.setAttribute(
    'normal',
    attribute((vertex) => vertex.normal, 3),
  )
  geometry.setAttribute(
    'paint',
    attribute((vertex) => vertex.paint, 4),
  )

  const sizes = new Float32Array(placed.length * 3)
  const tints = new Float32Array(placed.length * 3)
  const material = new ShaderMaterial({
    uniforms: shadingUniforms(),
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
