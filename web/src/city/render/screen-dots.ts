import {
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  type IUniform,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'
import type { Vec3 } from '../world/units'

// Round dots at points of the world, a fixed number of pixels wide whatever their distance,
// filled and rimmed: the ends of a line laid on the water.

const vertexShader = /* glsl */ `
uniform vec2 resolution;
uniform float reach;
attribute vec3 centre;
attribute vec2 corner;
varying vec2 vLocal;
void main() {
  vec4 clip = projectionMatrix * viewMatrix * vec4(centre, 1.0);
  vLocal = corner * reach;
  gl_Position = clip + vec4(corner * reach / resolution * 2.0 * clip.w, 0.0, 0.0);
}
`

const fragmentShader = /* glsl */ `
uniform float radius;
uniform float rim;
uniform vec3 fill;
uniform vec3 rimColour;
varying vec2 vLocal;
void main() {
  float d = length(vLocal);
  float cover = clamp(radius + rim - d + 0.5, 0.0, 1.0);
  if (cover <= 0.0) {
    discard;
  }
  float inside = clamp(radius - d + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(mix(rimColour, fill, inside), cover);
}
`

/** How dots look, in CSS pixels. */
export interface DotStyle {
  radius: number
  fill: Vec3
  /** A band around the fill. */
  rim: { width: number; colour: Vec3 }
}

/** Dots at these points, in one draw, over what is drawn before them. */
export function createScreenDots(
  points: readonly Vec3[],
  style: DotStyle,
  pixelRatio: number,
): Mesh {
  const geometry = new InstancedBufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(12), 3))
  geometry.setAttribute('corner', new Float32BufferAttribute([-1, -1, 1, -1, -1, 1, 1, 1], 2))
  geometry.setIndex([0, 1, 2, 2, 1, 3])
  geometry.setAttribute('centre', new InstancedBufferAttribute(new Float32Array(points.flat()), 3))
  geometry.instanceCount = points.length
  const radius = style.radius * pixelRatio
  const rim = style.rim.width * pixelRatio
  const resolution: IUniform<Vector2> = { value: new Vector2(1, 1) }
  const material = new ShaderMaterial({
    uniforms: {
      resolution,
      reach: { value: radius + rim + 1 },
      radius: { value: radius },
      rim: { value: rim },
      fill: { value: new Vector3(...style.fill) },
      rimColour: { value: new Vector3(...style.rim.colour) },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
  })
  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(resolution.value)
  }
  return mesh
}
