import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  ShaderMaterial,
  Vector2,
} from 'three'
import { CROWN_RADIUS, type Decor, FOLIAGE_TINTS, type TreeKind } from './decor'
import { createFading, dimmingFragmentPars, type Fading } from './dimming'
import type { Boat } from './links'
import { shadingFragmentPars, shadingUniforms, shadingVertex, shadingVertexPars } from './shading'
import { boardToThree, srgb, type Vec3 } from './world/units'

// Trees, rocks and boats are a few models repeated, one instanced draw call each. A part of a model
// takes the instance's tint (foliage) or a colour of its own (trunk, rock), then darkens (a
// flank) or lightens (a top). Below 3 px on screen, each instance shrinks away.

const TRUNK = srgb('#8A6A4A')
const ROCK = srgb('#ADA79B')
/** Flanks are `mix(f, black, 12 %)`, tops a little lighter. */
const FLANK_DARKENING = 0.12
const TOP_LIGHTENING = 0.14

/** One vertex of a model, in three.js coordinates (y up), for an instance of size 1. */
interface ModelVertex {
  position: Vec3
  normal: Vec3
  /** A colour of its own (alpha 1), or the instance's tint (alpha 0). */
  paint: [number, number, number, number]
  /** Toward black, then toward white. */
  tone: [number, number]
}

type Paint = { colour?: Vec3; tone?: [number, number] }

class ModelBuilder {
  readonly vertices: ModelVertex[] = []

  /**
   * A flat triangle, wound to face `facing`: by default away from the model's vertical axis,
   * as every side of a tree or rock does.
   */
  triangle(a: Vec3, b: Vec3, c: Vec3, { colour, tone = [0, 0] }: Paint, facing?: Vec3): void {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const
    const n: Vec3 = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ]
    const length = Math.hypot(...n)
    let normal: Vec3 = [n[0] / length, n[1] / length, n[2] / length]
    const out = facing ?? [a[0] + b[0] + c[0], 0, a[2] + b[2] + c[2]]
    let corners = [a, b, c]
    if (normal[0] * out[0] + normal[1] * out[1] + normal[2] * out[2] < 0) {
      normal = [-normal[0], -normal[1], -normal[2]]
      corners = [a, c, b]
    }
    const paint: ModelVertex['paint'] = colour ? [...colour, 1] : [0, 0, 0, 0]
    for (const position of corners) {
      this.vertices.push({ position, normal, paint, tone })
    }
  }

  /** A ring of `sides` points at height `y`, radius `r`, starting at angle 0. */
  static ring(sides: number, r: number, y: number): Vec3[] {
    return Array.from({ length: sides }, (_, i) => {
      const angle = (2 * Math.PI * i) / sides
      return [r * Math.cos(angle), y, -r * Math.sin(angle)] as Vec3
    })
  }

  /** The sides between two rings, from the lower to the upper, two triangles each. */
  prism(lower: Vec3[], upper: Vec3[], paint: Paint): void {
    lower.forEach((a, i) => {
      const j = (i + 1) % lower.length
      const b = lower[j] as Vec3
      const c = upper[j] as Vec3
      const d = upper[i] as Vec3
      this.triangle(a, b, c, paint)
      this.triangle(a, c, d, paint)
    })
  }

  /** A flat top over a convex ring, as a fan from its first point. */
  cap(ring: Vec3[], paint: Paint): void {
    for (let i = 1; i < ring.length - 1; i++) {
      this.triangle(ring[0] as Vec3, ring[i] as Vec3, ring[i + 1] as Vec3, paint, [0, 1, 0])
    }
  }

  /** A cone from a ring to its apex. */
  cone(ring: Vec3[], apex: Vec3, paint: Paint): void {
    ring.forEach((a, i) => {
      this.triangle(a, ring[(i + 1) % ring.length] as Vec3, apex, paint)
    })
  }
}

/** A cone of 6 sides, radius 0.42, 1.8 tall, standing 0.12 u up. */
function coniferModel(): ModelVertex[] {
  const builder = new ModelBuilder()
  builder.cone(ModelBuilder.ring(6, CROWN_RADIUS.conifer, 0.12), [0, 0.12 + 1.8, 0], {})
  return builder.vertices
}

/** A 4-sided trunk under two hexagonal tiers, the upper one tapering. */
function roundTreeModel(): ModelVertex[] {
  const builder = new ModelBuilder()
  const trunk = { colour: TRUNK }
  builder.prism(ModelBuilder.ring(4, 0.08, 0), ModelBuilder.ring(4, 0.08, 0.45), trunk)
  const flank = { tone: [FLANK_DARKENING, 0] as [number, number] }
  const top = { tone: [0, TOP_LIGHTENING] as [number, number] }
  const lowerTop = ModelBuilder.ring(6, CROWN_RADIUS.round, 1.0)
  builder.prism(ModelBuilder.ring(6, CROWN_RADIUS.round, 0.4), lowerTop, flank)
  builder.cap(lowerTop, top)
  const upperTop = ModelBuilder.ring(6, 0.24, 1.22)
  builder.prism(ModelBuilder.ring(6, 0.28, 1.0), upperTop, flank)
  builder.cap(upperTop, top)
  return builder.vertices
}

/** A cone of 5 sides, 0.8 as tall as its radius 1. */
function rockModel(): ModelVertex[] {
  const builder = new ModelBuilder()
  builder.cone(ModelBuilder.ring(5, 1, 0), [0, 0.8, 0], { colour: ROCK })
  return builder.vertices
}

const HULL = srgb('#3E4A57')
const BOAT_DECK = srgb('#F4EEE2')
const MAINSAIL = srgb('#FFFFFF')
const JIB = srgb('#EFE6D3')
/** The hull: 2 × 0.7 u, 0.3 u high, a little of it under water. */
const HULL_SIZE = { length: 2, beam: 0.7, bottom: -0.05, top: 0.25 }

/**
 * A sailboat heading along x: a box of a hull under a mainsail (2.3 u) and a jib (1.8 u), each
 * sail a triangle seen from both sides.
 */
function boatModel(): ModelVertex[] {
  const builder = new ModelBuilder()
  const { length, beam, bottom, top } = HULL_SIZE
  const x0 = -length / 2
  const x1 = length / 2
  const z0 = -beam / 2
  const z1 = beam / 2
  const hull = { colour: HULL }
  const corner = (x: number, y: number, z: number): Vec3 => [x, y, z]
  builder.triangle(
    corner(x0, top, z0),
    corner(x1, top, z0),
    corner(x1, top, z1),
    { colour: BOAT_DECK },
    [0, 1, 0],
  )
  builder.triangle(
    corner(x0, top, z0),
    corner(x1, top, z1),
    corner(x0, top, z1),
    { colour: BOAT_DECK },
    [0, 1, 0],
  )
  for (const [a, b, facing] of [
    [corner(x0, 0, z0), corner(x1, 0, z0), [0, 0, -1]],
    [corner(x1, 0, z0), corner(x1, 0, z1), [1, 0, 0]],
    [corner(x1, 0, z1), corner(x0, 0, z1), [0, 0, 1]],
    [corner(x0, 0, z1), corner(x0, 0, z0), [-1, 0, 0]],
  ] as const) {
    const lowA: Vec3 = [a[0], bottom, a[2]]
    const lowB: Vec3 = [b[0], bottom, b[2]]
    const highA: Vec3 = [a[0], top, a[2]]
    const highB: Vec3 = [b[0], top, b[2]]
    builder.triangle(lowA, lowB, highB, hull, [...facing])
    builder.triangle(lowA, highB, highA, hull, [...facing])
  }
  const sails: [Vec3, Vec3, Vec3, Vec3][] = [
    [[0.15, top, 0], [-0.75, top + 0.05, 0], [0.15, top + 2.3, 0], MAINSAIL],
    [[0.25, top, 0], [0.95, top, 0], [0.25, top + 1.8, 0], JIB],
  ]
  for (const [a, b, c, colour] of sails) {
    builder.triangle(a, b, c, { colour }, [0, 0, 1])
    builder.triangle(a, b, c, { colour }, [0, 0, -1])
  }
  return builder.vertices
}

export const DECOR_MODELS = {
  conifer: coniferModel(),
  round: roundTreeModel(),
  rock: rockModel(),
  boat: boatModel(),
} satisfies Record<TreeKind | 'rock' | 'boat', ModelVertex[]>

/** How wide a model is for size 1: what must show on screen for it to be drawn. */
const MODEL_WIDTH = {
  conifer: 2 * CROWN_RADIUS.conifer,
  round: 2 * CROWN_RADIUS.round,
  rock: 2,
  boat: HULL_SIZE.length,
}

/** Below this many pixels across, an instance has shrunk to nothing; it is whole above. */
const VANISH_PIXELS = [3, 4.5] as const

const BEGIN_VERTEX = '#include <begin_vertex>'

const vertexShader = /* glsl */ `
${shadingVertexPars}
uniform float viewportHeight;
uniform float modelWidth;
uniform float dim;
uniform float fades;
uniform vec4 keptArea;
attribute vec4 paint;
attribute vec2 tone;
attribute vec3 tint;
attribute float seed;
varying vec3 vColor;
varying float vDim;
void main() {
  vec3 colour = mix(tint, paint.rgb, paint.a);
  colour = mix(colour, vec3(0.0), tone.x);
  vColor = mix(colour, vec3(1.0), tone.y);
  // Trees fade with the buildings, but for those in the kept area (x and z, min then max).
  vec2 at = instanceMatrix[3].xz;
  bool kept = all(greaterThanEqual(at, keptArea.xy)) && all(lessThanEqual(at, keptArea.zw));
  vDim = kept ? 0.0 : dim * fades;
  // The instance's width in pixels, from its size and its distance; staggered by its seed.
  float size = length(instanceMatrix[0].xyz);
  vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float pixels = modelWidth * size * projectionMatrix[1][1] * 0.5 * viewportHeight
    / max(-centre.z, 1e-3);
  float shrink = smoothstep(${VANISH_PIXELS[0].toFixed(1)}, ${VANISH_PIXELS[1].toFixed(1)},
    pixels * (0.8 + 0.4 * seed));
  ${shadingVertex.replace(BEGIN_VERTEX, 'vec3 transformed = position * shrink;')}
}
`

const fragmentShader = /* glsl */ `
${shadingFragmentPars}
${dimmingFragmentPars}
varying vec3 vColor;
varying float vDim;
void main() {
  gl_FragColor = vec4(shade(dimmed(vColor, vDim), normalize(vWorldNormal), dimmedShadows(vDim)), 1.0);
}
`

interface Instance {
  position: Vec3
  angle: number
  size: number
  tint: Vec3
  seed: number
}

const FOLIAGE = FOLIAGE_TINTS.map(srgb)

export interface DecorStats {
  instances: number
  triangles: number
}

/** How many trees, rocks and boats a city has, and their triangles before any shrinks away. */
export function decorStats(decor: Decor, boats: readonly Boat[] = []): DecorStats {
  const triangles = (model: keyof typeof DECOR_MODELS) => DECOR_MODELS[model].length / 3
  return {
    instances: decor.trees.length + decor.rocks.length + boats.length,
    triangles:
      decor.trees.reduce((sum, tree) => sum + triangles(tree.kind), 0) +
      decor.rocks.length * triangles('rock') +
      boats.length * triangles('boat'),
  }
}

/** Every tree, rock and boat of the city, in at most four draw calls; trees fade, if asked. */
export function createDecor(
  decor: Decor,
  boats: readonly Boat[] = [],
  fading: Fading = createFading(),
): Group {
  const byModel: Record<keyof typeof DECOR_MODELS, Instance[]> = {
    conifer: [],
    round: [],
    rock: [],
    boat: [],
  }
  for (const tree of decor.trees) {
    byModel[tree.kind].push({
      position: boardToThree(tree.x, tree.y, tree.z),
      angle: tree.angle,
      size: tree.size,
      tint: FOLIAGE[tree.foliage] ?? FOLIAGE[0] ?? ROCK,
      seed: tree.seed,
    })
  }
  for (const rock of decor.rocks) {
    byModel.rock.push({
      position: boardToThree(rock.x, rock.y, 0),
      angle: rock.angle,
      size: rock.radius,
      tint: ROCK,
      seed: rock.seed,
    })
  }
  byModel.boat.push(...boats.map(boatInstance))
  const group = new Group()
  for (const model of ['conifer', 'round', 'rock', 'boat'] as const) {
    const instances = byModel[model]
    if (instances.length > 0) {
      const fades = model === 'conifer' || model === 'round'
      group.add(instancedModel(DECOR_MODELS[model], MODEL_WIDTH[model], instances, fading, fades))
    }
  }
  return group
}

/** Boats that sail, apart from the rest: their places change at every frame. */
export function createBoats(boats: readonly Boat[], fading: Fading): InstancedMesh {
  const mesh = instancedModel(
    DECOR_MODELS.boat,
    MODEL_WIDTH.boat,
    boats.map(boatInstance),
    fading,
    false,
  )
  // Moving, its instances leave the bounds three.js would compute once.
  mesh.frustumCulled = false
  return mesh
}

function boatInstance(boat: Boat): Instance {
  return {
    position: boardToThree(boat.x, boat.y, 0),
    angle: boat.angle,
    size: 1,
    tint: HULL,
    seed: boat.seed,
  }
}

/** A boat's length, in u: how big it is on screen tells whether its sailing shows. */
export const BOAT_LENGTH = HULL_SIZE.length

function instancedModel(
  vertices: ModelVertex[],
  width: number,
  instances: Instance[],
  { dim, keptArea }: Fading,
  fades: boolean,
) {
  const geometry = new BufferGeometry()
  const attribute = (name: keyof ModelVertex) => {
    const values = vertices.flatMap((vertex) => vertex[name])
    geometry.setAttribute(name, new Float32BufferAttribute(values, values.length / vertices.length))
  }
  attribute('position')
  attribute('normal')
  attribute('paint')
  attribute('tone')

  const uniforms = {
    ...shadingUniforms(),
    viewportHeight: { value: 1 },
    modelWidth: { value: width },
    dim,
    keptArea,
    fades: { value: fades ? 1 : 0 },
  }
  const material = new ShaderMaterial({ uniforms, vertexShader, fragmentShader, lights: true })
  const mesh = new InstancedMesh(geometry, material, instances.length)
  const tints = new Float32Array(instances.length * 3)
  const seeds = new Float32Array(instances.length)
  const matrix = new Matrix4()
  const scale = new Matrix4()
  instances.forEach(({ position, angle, size, tint, seed }, index) => {
    matrix.makeRotationY(angle).multiply(scale.makeScale(size, size, size))
    mesh.setMatrixAt(index, matrix.setPosition(...position))
    tints.set(tint, index * 3)
    seeds[index] = seed
  })
  geometry.setAttribute('tint', new InstancedBufferAttribute(tints, 3))
  geometry.setAttribute('seed', new InstancedBufferAttribute(seeds, 1))
  // The shrinking needs the drawing buffer's height, which follows the window.
  const buffer = new Vector2()
  mesh.onBeforeRender = (renderer) => {
    uniforms.viewportHeight.value = renderer.getDrawingBufferSize(buffer).y
  }
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}
