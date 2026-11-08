import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  type IUniform,
  Matrix4,
  MeshDepthMaterial,
  ShaderMaterial,
} from 'three'
import { createFading, dimmingFragmentPars, type Fading } from '../render/dimming'
import {
  shadingFragmentPars,
  shadingUniforms,
  shadingVertex,
  shadingVertexPars,
} from '../render/shading'
import type { BuildingLanguage, CityLayout, ConcreteFamily, FileMetrics } from '../world/layout'
import { srgb, type Vec3 } from '../world/units'
import { buildingGeometry, type Shape, shapeKey, type Vertex } from './archetype-geometry'
import { ARCHETYPES } from './archetypes'
import { type PlacedBuilding, placeBuildings } from './placed-buildings'

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
/** Shades of concrete, close enough to read as one material: docs keep the design's `#D9D5CC`. */
const CONCRETE_TINTS: Record<ConcreteFamily, Vec3> = {
  docs: srgb('#D9D5CC'),
  markup: srgb('#DED3C3'),
  data: srgb('#CFD4D3'),
  styles: srgb('#DCCFD0'),
  scripts: srgb('#D3D2C0'),
}
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

/** How a building stands out: hovered faces are lighter, a selected one keeps its colours. */
export const Highlight = { none: 0, hovered: 1, selected: 2 } as const
export type Highlight = (typeof Highlight)[keyof typeof Highlight]

/** A hovered building's faces: 20 % toward white. */
const HOVER_LIGHTENING = 0.2
/** A dimmed building's edges keep 70 % of their strength. */
const DIMMED_EDGES = 0.7

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
attribute float stamped;
attribute vec4 stampCentre;
// Generated (1 or 0), its highlight, and kept from fading (1 or 0): one attribute, as a vertex
// shader has 16 at most and this one uses 15.
attribute vec3 state;
uniform float dim;
varying vec3 vColor;
varying vec3 vEdge;
varying vec3 vEdgeColor;
varying vec3 vLocal;
varying float vSide;
varying float vRoof;
varying vec2 vStampCentre;
varying vec3 vTint;
varying float vHovered;
varying float vDim;
void main() {
  vColor = mix(tint, paint.rgb, paint.a);
  vHovered = state.y > 0.5 && state.y < 1.5 ? 1.0 : 0.0;
  // Hovered beats faded: the building under the pointer shows its colours.
  vDim = dim * (1.0 - max(state.z, vHovered));
  vEdgeColor = tint * ${(1 - EDGE_DARKENING).toFixed(6)};
  vRoof = 0.0;
  if (state.x > 0.5) {
    // Only the faces painted from the language: wood, stone and kiosks keep their colour
    if (abs(normal.y) < 0.5 && paint.a < 0.999) {
      vColor = mix(tint, ${glslColour(GENERATED_WALL)}, ${GENERATED_WALL_SHARE.toFixed(6)});
    }
    vEdgeColor = mix(tint, ${glslColour(GENERATED_EDGE)}, ${GENERATED_EDGE_SHARE.toFixed(6)});
    vRoof = stamped;
  }
  vStampCentre = stampCentre.xz + stampCentre.yw * building.x;
  vEdge = edge;
  vSide = building.x;
  vTint = tint;
  ${shadingVertex.replace(BEGIN_VERTEX, stretchVertex)}
  vLocal = transformed;
}
`

const fragmentShader = /* glsl */ `
${shadingFragmentPars}
${dimmingFragmentPars}
uniform float edgeWidth;
varying float vHovered;
varying float vDim;
varying vec3 vColor;
varying vec3 vEdge;
varying vec3 vEdgeColor;
varying vec3 vLocal;
varying float vSide;
varying float vRoof;
varying vec2 vStampCentre;
varying vec3 vTint;
void main() {
  vec3 colour = vColor;
  if (vRoof > 0.5) {
    float across = abs(vLocal.x - vStampCentre.x);
    float bar = min(across, abs(across - ${BAR_SPACING.toFixed(6)} * vSide));
    float along = abs(vLocal.z - vStampCentre.y);
    if (bar < ${(BAR_WIDTH / 2).toFixed(6)} && along < ${(BAR_LENGTH / 2).toFixed(6)} * vSide) {
      colour = vTint * ${(1 - GENERATED_BAR_DARKENING).toFixed(6)};
    }
  }
  colour = mix(colour, vec3(1.0), ${HOVER_LIGHTENING.toFixed(6)} * vHovered);
  colour = dimmed(colour, vDim);
  // Distance to each side in pixels; a side without a line stays far away.
  vec3 perPixel = sqrt(dFdx(vEdge) * dFdx(vEdge) + dFdy(vEdge) * dFdy(vEdge));
  vec3 toSide = vEdge / max(perPixel, 1e-6);
  float d = min(min(toSide.x, toSide.y), toSide.z);
  // The share of this pixel covered by the line: a sub-pixel line is a lighter pixel.
  float cover = clamp(min(edgeWidth, d + 0.5) - max(0.0, d - 0.5), 0.0, 1.0);
  cover *= mix(1.0, ${DIMMED_EDGES.toFixed(6)}, vDim);
  vec3 lit = shade(colour, normalize(vWorldNormal), dimmedShadows(vDim));
  gl_FragColor = vec4(mix(lit, vEdgeColor, cover), 1.0);
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
  'stamped',
  'stampCentre',
] as const satisfies readonly (keyof Vertex)[]

/** The buildings of a city, and how to make some of them stand out. */
export interface CityBuildings {
  group: Group
  /** Every building, in the order the city's islands and lots come. */
  placed: readonly PlacedBuilding[]
  /** Makes the building at this index of `placed` stand out, or not. */
  setHighlight(index: number, highlight: Highlight): void
  /** The buildings that keep their colours while the city fades; all of them if null. */
  setKept(kept: ((index: number) => boolean) | null): void
}

/** Where each part of a building's state lies in its `state` attribute. */
const GENERATED = 0
const HIGHLIGHT = 1
const KEPT = 2

/** Where a building is drawn: its shape's mesh and its instance there. */
interface Slot {
  mesh: InstancedMesh
  instance: number
}

/**
 * Every building, in one instanced draw call per shape: an archetype of one model, or one
 * combination of a low building's pieces. Edges are sized for `pixelRatio`.
 */
export function createBuildings(
  layout: CityLayout,
  pixelRatio: number,
  { dim }: Fading = createFading(),
): CityBuildings {
  const placed = placeBuildings(layout)
  const byShape = new Map<string, { shape: Shape; members: number[] }>()
  placed.forEach(({ building }, index) => {
    const key = shapeKey(building)
    const entry = byShape.get(key) ?? { shape: building, members: [] }
    entry.members.push(index)
    byShape.set(key, entry)
  })

  const group = new Group()
  const slots: Slot[] = []
  // Archetype by archetype, then shape by shape: the same city draws in the same order
  const order = (key: string) => ARCHETYPES.indexOf(byShape.get(key)?.shape.archetype ?? 'hall')
  const keys = [...byShape.keys()].sort((a, b) => order(a) - order(b) || (a < b ? -1 : 1))
  for (const key of keys) {
    const entry = byShape.get(key)
    if (entry) {
      const members = entry.members.map((index) => placed[index] as PlacedBuilding)
      const mesh = instancedShape(entry.shape, members, EDGE_WIDTH * pixelRatio, dim)
      entry.members.forEach((index, instance) => {
        slots[index] = { mesh, instance }
      })
      group.add(mesh)
    }
  }

  const stateOf = (mesh: InstancedMesh) =>
    mesh.geometry.getAttribute('state') as InstancedBufferAttribute
  return {
    group,
    placed,
    setHighlight(index, highlight) {
      const slot = slots[index]
      if (slot) {
        const state = stateOf(slot.mesh)
        state.setComponent(slot.instance, HIGHLIGHT, highlight)
        state.addUpdateRange(slot.instance * 3 + HIGHLIGHT, 1)
        state.needsUpdate = true
      }
    },
    setKept(kept) {
      const touched = new Set<InstancedMesh>()
      slots.forEach(({ mesh, instance }, index) => {
        stateOf(mesh).setComponent(instance, KEPT, kept === null || kept(index) ? 1 : 0)
        touched.add(mesh)
      })
      for (const mesh of touched) {
        const state = stateOf(mesh)
        state.clearUpdateRanges()
        state.needsUpdate = true
      }
    },
  }
}

function tintOf(file: FileMetrics): Vec3 {
  if (file.analyzed === false) {
    return CONCRETE_TINTS[file.family ?? 'docs']
  }
  return file.test ? TEST_COLOUR : LANGUAGE_COLOURS[file.language]
}

function instancedShape(
  shape: Shape,
  placed: readonly PlacedBuilding[],
  edgeWidth: number,
  dim: IUniform<number>,
): InstancedMesh {
  const vertices = buildingGeometry(shape).flat()
  const geometry = new BufferGeometry()
  for (const name of VERTEX_ATTRIBUTES) {
    const values = vertices.flatMap((vertex) => vertex[name])
    geometry.setAttribute(name, new Float32BufferAttribute(values, values.length / vertices.length))
  }

  const sizes = new Float32Array(placed.length * 3)
  const tints = new Float32Array(placed.length * 3)
  const states = new Float32Array(placed.length * 3)
  const material = new ShaderMaterial({
    uniforms: { ...shadingUniforms(), edgeWidth: { value: edgeWidth }, dim },
    vertexShader,
    fragmentShader,
    lights: true,
  })
  const mesh = new InstancedMesh(geometry, material, placed.length)
  const matrix = new Matrix4()
  placed.forEach(({ building, position, angle, file }, index) => {
    mesh.setMatrixAt(index, matrix.makeRotationY(angle).setPosition(...position))
    sizes.set([building.side, building.height, building.split], index * 3)
    tints.set(tintOf(file), index * 3)
    states[index * 3 + GENERATED] = file.generated === true ? 1 : 0
    states[index * 3 + KEPT] = 1
  })
  geometry.setAttribute('building', new InstancedBufferAttribute(sizes, 3))
  geometry.setAttribute('tint', new InstancedBufferAttribute(tints, 3))
  geometry.setAttribute('state', new InstancedBufferAttribute(states, 3))

  mesh.customDepthMaterial = stretchedDepthMaterial()
  mesh.castShadow = true
  mesh.receiveShadow = true
  // The shader moves the vertices: three.js cannot bound them, and the city is one whole anyway.
  mesh.frustumCulled = false
  return mesh
}
