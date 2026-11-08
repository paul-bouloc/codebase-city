import { DirectionalLight, type Scene, type Vector3, type WebGLRenderer } from 'three'
import { SUN_DIRECTION } from '../render/light'

const SHADOW_MAP_SIZE = 4096
/** Room around the city for the shadows of the tallest towers. */
export const SHADOW_MARGIN = 25

/** The fixed sun, and the shadows it casts over the whole city. */
export class CitySun {
  private readonly light = new DirectionalLight()

  constructor(renderer: WebGLRenderer, scene: Scene) {
    this.light.castShadow = true
    const mapSize = Math.min(SHADOW_MAP_SIZE, renderer.capabilities.maxTextureSize)
    this.light.shadow.mapSize.set(mapSize, mapSize)
    scene.add(this.light, this.light.target)
  }

  /** One square orthographic shadow camera over the whole city, along the fixed sun. */
  fit(centre: Vector3, extent: number): void {
    this.light.target.position.copy(centre)
    this.light.position
      .set(...SUN_DIRECTION)
      .multiplyScalar(2 * extent)
      .add(centre)
    const camera = this.light.shadow.camera
    camera.left = -extent
    camera.right = extent
    camera.top = extent
    camera.bottom = -extent
    camera.near = 0.1
    camera.far = 4 * extent
    camera.updateProjectionMatrix()
    const texel = (2 * extent) / this.light.shadow.mapSize.x
    this.light.shadow.normalBias = 1.5 * texel
    this.light.shadow.bias = -0.0002
  }

  dispose(): void {
    this.light.shadow.dispose()
  }
}
