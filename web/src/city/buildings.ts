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
import type { BuildingLanguage, CityLayout, FileMetrics } from './layout'
import { placementFor } from './scatter'
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
/** Concrete faces are painted as they are; this tint only gives their edges `#8F8A80`. */
const CONCRETE_TINT = srgb('#F6EEDC')
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

// A generated file keeps its archetype, with walls of pale concrete, grey edges and three bars
// stamped on its roof, drawn here rather than built.
const GENERATED_WALL = '#D9D5CC'
const GENERATED_WALL_SHARE = 0.82
const GENERATED_EDGE = '#5E6468'
const GENERATED_EDGE_SHARE = 0.6
const GENERATED_BAR_DARKENING = 0.25
/** Bars: 0.09 u wide, 0.86 × side long, at −0.3, 0 and +0.3 × side. */
const BAR_WIDTH = 0.09
const BAR_LENGTH = 0.86
const BAR_SPACING = 0.3

const glslColour = (hex: string) =>
  `vec3(${srgb(hex)
    .map((c) => c.toFixed(6))
    .join(', ')})`

const vertexShader = /* glsl */ `
${shadingVertexPars}
${stretchPars}
attribute vec4 paint;
attribute vec3 tint;
attribute vec3 edge;
attribute float generated;
varying vec3 vColor;
varying vec3 vEdge;
varying vec3 vEdgeColor;
varying vec3 vLocal;
varying float vSide;
varying float vRoof;
varying vec3 vTint;
void main() {
  vColor = mix(tint, paint.rgb, paint.a);
  vEdgeColor = tint * ${(1 - EDGE_DARKENING).toFixed(6)};
  vRoof = 0.0;
  if (generated > 0.5) {
    // Only the faces painted from the language: wood, stone and kiosks keep their colour
    if (abs(normal.y) < 0.5 && paint.a < 0.999) {
      vColor = mix(tint, ${glslColour(GENERATED_WALL)}, ${GENERATED_WALL_SHARE.toFixed(6)});
    }
    vEdgeColor = mix(tint, ${glslColour(GENERATED_EDGE)}, ${GENERATED_EDGE_SHARE.toFixed(6)});
    vRoof = normal.y > 0.5 ? 1.0 : 0.0;
  }
  vEdge = edge;
  vSide = building.x;
  vTint = tint;
  ${shadingVertex.replace(BEGIN_VERTEX, stretchVertex)}
  vLocal = transformed;
}
`

const fragmentShader = /* glsl */ `
${shadingFragmentPars}
uniform float edgeWidth;
varying vec3 vColor;
varying vec3 vEdge;
varying vec3 vEdgeColor;
varying vec3 vLocal;
varying float vSide;
varying float vRoof;
varying vec3 vTint;
void main() {
  vec3 colour = vColor;
  if (vRoof > 0.5) {
    float across = abs(vLocal.x);
    float bar = min(across, abs(across - ${BAR_SPACING.toFixed(6)} * vSide));
    if (bar < ${(BAR_WIDTH / 2).toFixed(6)} && abs(vLocal.z) < ${(BAR_LENGTH / 2).toFixed(6)} * vSide) {
      colour = vTint * ${(1 - GENERATED_BAR_DARKENING).toFixed(6)};
    }
  }
  // Distance to each side in pixels; a side without a line stays far away.
  vec3 perPixel = sqrt(dFdx(vEdge) * dFdx(vEdge) + dFdy(vEdge) * dFdy(vEdge));
  vec3 toSide = vEdge / max(perPixel, 1e-6);
  float d = min(min(toSide.x, toSide.y), toSide.z);
  // The share of this pixel covered by the line: a sub-pixel line is a lighter pixel.
  float cover = clamp(min(edgeWidth, d + 0.5) - max(0.0, d - 0.5), 0.0, 1.0);
  gl_FragColor = vec4(mix(shade(colour, normalize(vWorldNormal)), vEdgeColor, cover), 1.0);
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
  /** Turn about the vertical, in radians. */
  angle: number
  tint: Vec3
  generated: boolean
}

/** Every building, in one instanced draw call per archetype; edges are sized for `pixelRatio`. */
export function createBuildings(layout: CityLayout, pixelRatio: number): Group {
  const byArchetype = new Map<Archetype, Placed[]>()
  for (const island of layout.islands) {
    const altitude = layerAltitude(island.layer)
    for (const lot of island.lots) {
      const building = buildingFor(lot.file)
      const { dx, dy, angle } = placementFor(building, lot.x, lot.y, lot.ground)
      const placed = byArchetype.get(building.archetype) ?? []
      placed.push({
        building,
        position: boardToThree(lot.x + dx, lot.y + dy, altitude + (lot.base ?? 0)),
        angle,
        tint: tintOf(lot.file),
        generated: lot.file.generated === true,
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

function tintOf(file: FileMetrics): Vec3 {
  if (file.analyzed === false) {
    return CONCRETE_TINT
  }
  return file.test ? TEST_COLOUR : LANGUAGE_COLOURS[file.language]
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
  const generated = new Float32Array(placed.length)
  const material = new ShaderMaterial({
    uniforms: { ...shadingUniforms(), edgeWidth: { value: edgeWidth } },
    vertexShader,
    fragmentShader,
    lights: true,
  })
  const mesh = new InstancedMesh(geometry, material, placed.length)
  const matrix = new Matrix4()
  placed.forEach(({ building, position, angle, tint, generated: made }, index) => {
    mesh.setMatrixAt(index, matrix.makeRotationY(angle).setPosition(...position))
    sizes.set([building.side, building.height, building.split], index * 3)
    tints.set(tint, index * 3)
    generated[index] = made ? 1 : 0
  })
  geometry.setAttribute('building', new InstancedBufferAttribute(sizes, 3))
  geometry.setAttribute('tint', new InstancedBufferAttribute(tints, 3))
  geometry.setAttribute('generated', new InstancedBufferAttribute(generated, 1))

  mesh.customDepthMaterial = stretchedDepthMaterial()
  mesh.castShadow = true
  mesh.receiveShadow = true
  // The shader moves the vertices: three.js cannot bound them, and the city is one whole anyway.
  mesh.frustumCulled = false
  return mesh
}
