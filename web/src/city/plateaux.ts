import {
  BoxGeometry,
  type BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  ShaderMaterial,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { CityLayout } from './layout'
import { shadingFragmentPars, shadingUniforms, shadingVertex, shadingVertexPars } from './shading'
import { boardToThree, layerAltitude, srgb } from './units'

const PAVING = srgb('#EDE3CF')
const CLIFF = srgb('#D2AE84')

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

/**
 * Every island as a flat-topped block at its layer's altitude, in one draw call: a placeholder
 * until islands get their terraces, beaches and cliffs.
 */
export function createPlateaux(layout: CityLayout): Mesh {
  const blocks = layout.islands.map(({ plateau, layer }) => {
    const altitude = layerAltitude(layer)
    const [x, y, z] = boardToThree(
      plateau.x + plateau.width / 2,
      plateau.y + plateau.height / 2,
      altitude / 2,
    )
    const block = new BoxGeometry(plateau.width, altitude, plateau.height).translate(x, y, z)
    paint(block)
    return block
  })
  const geometry = mergeGeometries(blocks)
  for (const block of blocks) {
    block.dispose()
  }
  const material = new ShaderMaterial({
    uniforms: shadingUniforms(),
    vertexShader,
    fragmentShader,
    lights: true,
    vertexColors: true,
  })
  const mesh = new Mesh(geometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** Paving on top, cliff on the sides. */
function paint(geometry: BufferGeometry) {
  const normals = geometry.getAttribute('normal')
  const colors = new Float32Array(normals.count * 3)
  for (let i = 0; i < normals.count; i++) {
    colors.set(normals.getY(i) > 0.5 ? PAVING : CLIFF, i * 3)
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
}
