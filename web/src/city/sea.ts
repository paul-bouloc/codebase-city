import {
  DataTexture,
  LinearFilter,
  Mesh,
  PlaneGeometry,
  RedFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
} from 'three'
import type { CityLayout } from './layout'
import { DEPTH_BANDS, SEA_FIELD_RANGE, seaField } from './sea-field'
import { shadingFragmentPars, shadingUniforms, shadingVertex, shadingVertexPars } from './shading'
import { srgb } from './units'

/** The open sea, past the last depth band; also the scene's background. */
export const OPEN_SEA = '#4F9EA5'

/** From the shore out. */
const BAND_COLORS = ['#94CFCB', '#80C3C2', '#73BABB', '#66B1B5', '#5AA8AE']

const GRID_SPACING = 10
const GRID_OPACITY = 0.18
const BAND_EDGE_LIGHTEN = 0.3
const BAND_EDGE_WIDTH = 0.3

const vertexShader = /* glsl */ `
${shadingVertexPars}
varying vec2 vBoard;
void main() {
  ${shadingVertex}
  vec4 world = modelMatrix * vec4(position, 1.0);
  vBoard = vec2(world.x, -world.z);
}
`

const fragmentShader = /* glsl */ `
${shadingFragmentPars}
uniform sampler2D seaField;
uniform vec2 fieldOrigin;
uniform vec2 fieldSize;
uniform vec3 openSea;
uniform vec3 bandColors[${DEPTH_BANDS.length}];
uniform float bandEdges[${DEPTH_BANDS.length}];
uniform vec2 cityCentre;
uniform vec2 gridFade;
varying vec2 vBoard;

void main() {
  float depth = texture2D(seaField, (vBoard - fieldOrigin) / fieldSize).r
    * ${SEA_FIELD_RANGE.toFixed(1)};
  float depthStep = fwidth(depth);
  // Lines at least a pixel wide, so they hold when the camera pulls back.
  float halfWidth = max(${(BAND_EDGE_WIDTH / 2).toFixed(3)}, 0.5 * depthStep);

  vec3 color = openSea;
  for (int i = ${DEPTH_BANDS.length - 1}; i >= 0; i--) {
    if (depth < bandEdges[i]) color = bandColors[i];
  }
  for (int i = 0; i < ${DEPTH_BANDS.length}; i++) {
    float edge = 1.0 - smoothstep(halfWidth, halfWidth + depthStep, abs(depth - bandEdges[i]));
    color = mix(color, mix(bandColors[i], vec3(1.0), ${BAND_EDGE_LIGHTEN.toFixed(2)}), edge);
  }

  // A one-pixel chart grid that fades out away from the city, and before it would shimmer.
  vec2 perPixel = fwidth(vBoard);
  vec2 toLine = abs(fract(vBoard / ${GRID_SPACING.toFixed(1)} + 0.5) - 0.5)
    * ${GRID_SPACING.toFixed(1)};
  vec2 lines = 1.0 - clamp(toLine / perPixel, 0.0, 1.0);
  float grid = max(lines.x, lines.y)
    * (1.0 - smoothstep(gridFade.x, gridFade.y, distance(vBoard, cityCentre)))
    * (1.0 - smoothstep(${(GRID_SPACING / 12).toFixed(2)}, ${(GRID_SPACING / 6).toFixed(2)},
      max(perPixel.x, perPixel.y)));
  color = mix(color, vec3(1.0), ${GRID_OPACITY.toFixed(2)} * grid);

  gl_FragColor = vec4(shade(color, vec3(0.0, 1.0, 0.0)), 1.0);
}
`

/**
 * A chart-like sea: depth bands around the archipelago and a grid, at altitude 0. `reach` is how
 * far each island's beach stands past its plateau.
 */
export function createSea(layout: CityLayout, reach: readonly number[] = []): Mesh {
  const field = seaField(layout, reach)
  const texture = new DataTexture(
    field.data,
    field.columns,
    field.rows,
    RedFormat,
    UnsignedByteType,
  )
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.unpackAlignment = 1
  texture.needsUpdate = true

  const { bounds } = layout
  const citySize = Math.max(bounds.width, bounds.height, 10)
  const uniforms = {
    ...shadingUniforms(),
    seaField: { value: texture },
    fieldOrigin: { value: new Vector2(field.originX, field.originY) },
    fieldSize: { value: new Vector2(field.columns * field.texel, field.rows * field.texel) },
    openSea: { value: new Vector3(...srgb(OPEN_SEA)) },
    bandColors: { value: BAND_COLORS.map((hex) => new Vector3(...srgb(hex))) },
    bandEdges: { value: [...DEPTH_BANDS] },
    cityCentre: { value: new Vector2(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2) },
    gridFade: { value: new Vector2(1.5 * citySize, 2 * citySize) },
  }

  const size = seaSize(layout)
  const geometry = new PlaneGeometry(size, size).rotateX(-Math.PI / 2)
  const material = new ShaderMaterial({ uniforms, vertexShader, fragmentShader, lights: true })
  const sea = new Mesh(geometry, material)
  sea.receiveShadow = true
  return sea
}

/** Wide enough that its edge is never in view: past it, the background has the same colour. */
export function seaSize(layout: CityLayout): number {
  return 40 * Math.max(layout.bounds.width, layout.bounds.height, 10)
}
