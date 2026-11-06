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
import { createBridges } from './bridges'
import { createBuildings } from './buildings'
import { CityInteraction, type CityItem, type CityListeners } from './city-interaction'
import { cityDecor } from './decor'
import { createDecor, type DecorStats, decorStats } from './decor-mesh'
import { createFading } from './dimming'
import { createFerries } from './ferries'
import { islandShapes } from './island-shape'
import type { CityLayout } from './layout'
import { SUN_DIRECTION } from './light'
import { cityLinks } from './links'
import { CityPicker, type CityTarget } from './picking'
import { createParcels } from './plateaux'
import { createSea, OPEN_SEA, seaSize } from './sea'
import { createTerrain } from './terrain'
import { boardToThree, nearPlane } from './units'

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

/** A press that moves less than this, in CSS pixels, is a click, not a drag of the camera. */
const CLICK_SLOP = 4

const SHADOW_MAP_SIZE = 4096
/** Room around the city for the shadows of the tallest towers. */
const SHADOW_MARGIN = 25

export interface FrameStats {
  fps: number
  drawCalls: number
  triangles: number
  /** Trees, rocks and boats of the city, and their triangles at full size. */
  decor: DecorStats
  links: LinkStats
  /** How long the last search for what the pointer rests on took, in ms. */
  pickMs: number
}

/** How the imports between islands are drawn. */
export interface LinkStats {
  bridges: number
  ferries: number
  /** Links gathered at a port, not drawn. */
  inPorts: number
  /** Links not drawn: too small while nothing is selected, or with no way by water. */
  hidden: number
}

const NO_LINKS: LinkStats = { bridges: 0, ferries: 0, inPorts: 0, hidden: 0 }

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
  private decor: DecorStats = { instances: 0, triangles: 0 }
  private links: LinkStats = NO_LINKS
  private stats: FrameStats = {
    fps: 0,
    drawCalls: 0,
    triangles: 0,
    decor: { instances: 0, triangles: 0 },
    links: NO_LINKS,
    pickMs: 0,
  }
  private picker: CityPicker | null = null
  private interaction: CityInteraction | null = null
  private listeners: CityListeners = {}
  private readonly raycaster = new Raycaster()
  private readonly ndc = new Vector2()
  // Where the pointer is on the canvas, in CSS pixels; null when it is elsewhere.
  private pointer: { x: number; y: number; clientX: number; clientY: number } | null = null
  private pressedAt: { x: number; y: number } | null = null
  private cameraMoving = false
  private readonly removeListeners: () => void

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

    this.removeListeners = this.listenToPointer(this.renderer.domElement)
    this.setSize(container.clientWidth, container.clientHeight)
    this.renderer.setAnimationLoop((time) => this.frame(time))
  }

  /** Who hears of hover cards and selections. */
  setListeners(listeners: CityListeners): void {
    this.listeners = listeners
  }

  /** Selects a building or a folder, or nothing. */
  select(target: CityTarget | null): void {
    this.interaction?.select(target)
  }

  clearSelection(): void {
    this.select(null)
  }

  getSelection(): CityItem | null {
    return this.interaction?.getSelection() ?? null
  }

  private listenToPointer(canvas: HTMLCanvasElement): () => void {
    const move = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect()
      this.pointer = {
        x: event.clientX - box.left,
        y: event.clientY - box.top,
        clientX: event.clientX,
        clientY: event.clientY,
      }
      // A button held down drags the camera: nothing is hovered meanwhile.
      if (event.buttons === 0 && !this.cameraMoving) {
        this.hoverAtPointer()
      }
    }
    const leave = () => {
      this.pointer = null
      this.interaction?.point(null, { x: 0, y: 0 })
    }
    const down = (event: PointerEvent) => {
      this.pressedAt = event.button === 0 ? { x: event.clientX, y: event.clientY } : null
    }
    const up = (event: PointerEvent) => {
      const pressed = this.pressedAt
      this.pressedAt = null
      if (
        event.button !== 0 ||
        !pressed ||
        Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > CLICK_SLOP
      ) {
        return
      }
      move(event)
      // A click on the sea clears the selection.
      this.interaction?.select(this.pick())
    }
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerleave', leave)
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointerup', up)
    return () => {
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerleave', leave)
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointerup', up)
    }
  }

  /** What is under the pointer, if anything. */
  private pick(): CityTarget | null {
    const pointer = this.pointer
    const canvas = this.renderer.domElement
    if (!pointer || !this.picker || canvas.clientWidth === 0 || canvas.clientHeight === 0) {
      return null
    }
    const started = performance.now()
    this.ndc.set(
      (pointer.x / canvas.clientWidth) * 2 - 1,
      -(pointer.y / canvas.clientHeight) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.ndc, this.camera)
    const { origin, direction } = this.raycaster.ray
    const target = this.picker.pick({
      origin: [origin.x, origin.y, origin.z],
      direction: [direction.x, direction.y, direction.z],
    })
    this.stats.pickMs = performance.now() - started
    return target
  }

  private hoverAtPointer(): void {
    const pointer = this.pointer
    if (pointer) {
      this.interaction?.point(this.pick(), { x: pointer.clientX, y: pointer.clientY })
    }
  }

  /** Replaces the city on show and frames it. */
  load(layout: CityLayout): void {
    if (this.city) {
      this.scene.remove(this.city)
      disposeObject(this.city)
    }
    this.dropInteraction()
    const shapes = islandShapes(layout)
    const links = cityLinks(layout, shapes)
    const decor = cityDecor(layout, shapes, links)
    this.decor = decorStats(decor, links.boats)
    this.links = {
      bridges: links.bridges.length,
      ferries: links.ferries.length,
      inPorts: links.inPorts,
      hidden: links.hidden,
    }
    const pixelRatio = this.renderer.getPixelRatio()
    const fading = createFading()
    const buildings = createBuildings(layout, pixelRatio, fading)
    this.picker = new CityPicker(layout, buildings.placed)
    const interaction = new CityInteraction(
      layout,
      shapes,
      buildings,
      fading,
      pixelRatio,
      () => this.listeners,
      () => {
        this.needsRender = true
      },
    )
    this.interaction = interaction
    this.scene.add(interaction.overlay)
    this.city = new Group().add(
      createSea(
        layout,
        shapes.map((shape) => shape.reach),
      ),
      createTerrain(shapes),
      createParcels(layout, decor.gardens),
      createBridges(links),
      createFerries(links.ferries),
      buildings.group,
      createDecor(decor, links.boats, fading),
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

  /** Points the camera at a board point from `distance` u away; angles in degrees if given. */
  lookAt(x: number, y: number, distance: number, azimuth?: number, polar?: number): void {
    const [tx, , tz] = boardToThree(x, y, 0)
    if (azimuth !== undefined && polar !== undefined) {
      void this.controls.rotateTo((azimuth * Math.PI) / 180, (polar * Math.PI) / 180, false)
    }
    void this.controls.moveTo(tx, 0, tz, false)
    void this.controls.dollyTo(distance, false)
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
    this.removeListeners()
    this.dropInteraction()
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

  /** Forgets the hover and the selection of the city on show, and says so. */
  private dropInteraction(): void {
    const interaction = this.interaction
    if (interaction) {
      const selected = interaction.getSelection() !== null
      this.scene.remove(interaction.overlay)
      interaction.dispose()
      this.interaction = null
      if (selected) {
        this.listeners.select?.(null)
      }
    }
    this.picker = null
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
    if (moved !== this.cameraMoving) {
      this.cameraMoving = moved
      // No card while the camera moves; once it rests, what lies under the pointer may differ.
      if (moved) {
        this.interaction?.clearHover()
      } else {
        this.hoverAtPointer()
      }
    }
    if (this.interaction?.update(time)) {
      this.needsRender = true
    }
    if (moved || this.needsRender || this.continuous) {
      const near = nearPlane(this.controls.distance)
      if (near !== this.camera.near) {
        this.camera.near = near
        this.camera.updateProjectionMatrix()
      }
      this.renderer.render(this.scene, this.camera)
      this.needsRender = false
      this.framesSince++
      this.stats.drawCalls = this.renderer.info.render.calls
      this.stats.triangles = this.renderer.info.render.triangles
      this.stats.decor = this.decor
      this.stats.links = this.links
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
