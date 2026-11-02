import CameraControls from 'camera-controls'
import {
  Box3,
  Color,
  DirectionalLight,
  Group,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  type Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Scene,
  ShaderMaterial,
  Sphere,
  Spherical,
  Texture,
  Timer,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three'
import { createBuildings } from './buildings'
import { islandShapes } from './island-shape'
import type { CityLayout } from './layout'
import { SUN_DIRECTION } from './light'
import { createParcels } from './plateaux'
import { createSea, OPEN_SEA, seaSize } from './sea'
import { createTerrain } from './terrain'
import { boardToThree } from './units'

CameraControls.install({
  THREE: {
    Box3,
    MathUtils,
    Matrix4,
    Quaternion,
    Raycaster,
    Sphere,
    Spherical,
    Vector2,
    Vector3,
    Vector4,
  },
})

const FIELD_OF_VIEW = 38
/** About three lots across the view. */
const MIN_DISTANCE = 6
/** Never pull back further than twice the distance that frames the whole city. */
const MAX_FRAMING = 2
const MAX_POLAR_ANGLE = MathUtils.degToRad(75)
const START_AZIMUTH = MathUtils.degToRad(34)
const START_POLAR_ANGLE = MathUtils.degToRad(55)
/** How far the camera target may leave the city's edge. */
const TARGET_MARGIN = 20

const SHADOW_MAP_SIZE = 4096
/** Room around the city for the shadows of the tallest towers. */
const SHADOW_MARGIN = 25

export interface FrameStats {
  fps: number
  drawCalls: number
  triangles: number
}

export interface CityEngineOptions {
  /** Draw every frame, even when nothing moves: to measure the frame rate. */
  continuous?: boolean
}

/** The 3D city: owns its canvas, its WebGL context and everything it draws. */
export class CityEngine {
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera: PerspectiveCamera
  private readonly controls: CameraControls
  private readonly sun = new DirectionalLight()
  private readonly timer = new Timer()
  private readonly continuous: boolean
  private city: Group | null = null
  // The radius the camera frames the city with, once a city is loaded.
  private framingRadius: number | null = null
  private needsRender = true
  private framesSince = 0
  private statsSince = 0
  private stats: FrameStats = { fps: 0, drawCalls: 0, triangles: 0 }

  constructor(container: HTMLElement, { continuous = false }: CityEngineOptions = {}) {
    this.continuous = continuous
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFShadowMap
    // The sun is fixed and the city does not move: the shadow map is drawn once per city
    // (load), not on every frame the camera moves.
    this.renderer.shadowMap.autoUpdate = false
    container.append(this.renderer.domElement)

    this.scene.background = new Color(OPEN_SEA)
    this.camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 1, 1000)
    this.controls = new CameraControls(this.camera, this.renderer.domElement)
    this.controls.minDistance = MIN_DISTANCE
    this.controls.maxPolarAngle = MAX_POLAR_ANGLE
    this.controls.dollyToCursor = true

    this.sun.castShadow = true
    const mapSize = Math.min(SHADOW_MAP_SIZE, this.renderer.capabilities.maxTextureSize)
    this.sun.shadow.mapSize.set(mapSize, mapSize)
    this.scene.add(this.sun, this.sun.target)

    this.setSize(container.clientWidth, container.clientHeight)
    this.renderer.setAnimationLoop((time) => this.frame(time))
  }

  /** Replaces the city on show and frames it. */
  load(layout: CityLayout): void {
    if (this.city) {
      this.scene.remove(this.city)
      disposeObject(this.city)
    }
    const shapes = islandShapes(layout)
    this.city = new Group().add(
      createSea(
        layout,
        shapes.map((shape) => shape.reach),
      ),
      createTerrain(shapes),
      createParcels(layout),
      createBuildings(layout, this.renderer.getPixelRatio()),
    )
    this.scene.add(this.city)

    const { bounds } = layout
    const [cx, , cz] = boardToThree(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, 0)
    const centre = new Vector3(cx, 0, cz)
    const radius = Math.hypot(bounds.width, bounds.height) / 2
    this.fitShadows(centre, radius + SHADOW_MARGIN)

    this.camera.far = seaSize(layout)
    this.camera.updateProjectionMatrix()
    const framing = new Sphere(centre, Math.max(radius, MIN_DISTANCE))
    this.framingRadius = framing.radius
    this.fitMaxDistance()
    // The target stays on the sea plane: zooming to the cursor would otherwise drag it, and the
    // camera with it, under the water.
    const box = new Box3(
      new Vector3(cx - bounds.width / 2 - TARGET_MARGIN, 0, cz - bounds.height / 2 - TARGET_MARGIN),
      new Vector3(cx + bounds.width / 2 + TARGET_MARGIN, 0, cz + bounds.height / 2 + TARGET_MARGIN),
    )
    this.controls.setBoundary(box)
    void this.controls.rotateTo(START_AZIMUTH, START_POLAR_ANGLE, false)
    void this.controls.fitToSphere(framing, false)
    this.renderer.shadowMap.needsUpdate = true
    this.needsRender = true
  }

  setSize(width: number, height: number): void {
    if (width === 0 || height === 0) {
      return
    }
    this.renderer.setSize(width, height)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    // A portrait window needs more room to see the whole city than the one it loaded in.
    this.fitMaxDistance()
    this.needsRender = true
  }

  private fitMaxDistance(): void {
    if (this.framingRadius !== null) {
      this.controls.maxDistance =
        MAX_FRAMING * this.controls.getDistanceToFitSphere(this.framingRadius)
    }
  }

  getStats(): FrameStats {
    return this.stats
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null)
    this.controls.dispose()
    if (this.city) {
      disposeObject(this.city)
      this.city = null
    }
    this.sun.shadow.dispose()
    this.timer.dispose()
    if (import.meta.env.DEV) {
      const { geometries, textures } = this.renderer.info.memory
      if (geometries > 0 || textures > 0) {
        console.warn(`CityEngine leaked ${geometries} geometries and ${textures} textures`)
      }
    }
    this.renderer.dispose()
    // Browsers cap live WebGL contexts: give this one back now rather than at collection.
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }

  /** One square orthographic shadow camera over the whole city, along the fixed sun. */
  private fitShadows(centre: Vector3, extent: number): void {
    this.sun.target.position.copy(centre)
    this.sun.position
      .set(...SUN_DIRECTION)
      .multiplyScalar(2 * extent)
      .add(centre)
    const camera = this.sun.shadow.camera
    camera.left = -extent
    camera.right = extent
    camera.top = extent
    camera.bottom = -extent
    camera.near = 0.1
    camera.far = 4 * extent
    camera.updateProjectionMatrix()
    const texel = (2 * extent) / this.sun.shadow.mapSize.x
    this.sun.shadow.normalBias = 1.5 * texel
    this.sun.shadow.bias = -0.0002
  }

  private frame(time: number): void {
    this.timer.update(time)
    const moved = this.controls.update(this.timer.getDelta())
    if (moved || this.needsRender || this.continuous) {
      this.renderer.render(this.scene, this.camera)
      this.needsRender = false
      this.framesSince++
      this.stats.drawCalls = this.renderer.info.render.calls
      this.stats.triangles = this.renderer.info.render.triangles
    }
    const elapsed = time - this.statsSince
    if (elapsed >= 500) {
      this.stats.fps = Math.round((this.framesSince * 1000) / elapsed)
      this.framesSince = 0
      this.statsSince = time
    }
  }
}

function disposeObject(root: Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return
    }
    object.geometry.dispose()
    if (object instanceof InstancedMesh) {
      object.dispose()
    }
    const materials = [object.material, object.customDepthMaterial]
      .flat()
      .filter((material) => material !== undefined)
    for (const material of materials) {
      if (material instanceof ShaderMaterial) {
        for (const uniform of Object.values(material.uniforms)) {
          if (uniform.value instanceof Texture) {
            uniform.value.dispose()
          }
        }
      }
      material.dispose()
    }
  })
}
