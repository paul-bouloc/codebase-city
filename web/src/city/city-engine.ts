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
import { DASH_PERIOD, LABEL_HEIGHT, LABEL_LIFT } from './arc-mesh'
import { createBridges } from './bridges'
import { createBuildings } from './buildings'
import { CityControls } from './city-controls'
import {
  CityInteraction,
  type CityItem,
  type CityListeners,
  isClick,
  type Pointed,
} from './city-interaction'
import { indexCycles } from './cycles'
import { cityDecor } from './decor'
import { BOAT_LENGTH, createDecor, type DecorStats, decorStats } from './decor-mesh'
import { createFading } from './dimming'
import { type Drive, STILL } from './drive'
import { ExtraFerries } from './extra-ferries'
import { createFerries } from './ferries'
import { Fleet } from './fleet'
import { islandShapes } from './island-shape'
import type { CityLayout } from './layout'
import { SUN_DIRECTION } from './light'
import { cityLinks, type Port } from './links'
import { CityPicker, type CityTarget } from './picking'
import { createParcels } from './plateaux'
import { BADGE_HALF_WIDTH, badgeInView, portBadgeAt } from './port-links'
import { createSea, OPEN_SEA, seaSize } from './sea'
import { indexImports } from './selection-links'
import { createTerrain } from './terrain'
import { boardToThree, nearPlane, type Vec3 } from './units'

/** What a click opens: a bundle's hub, or a port. */
type Mark = Extract<Pointed, { kind: 'hub' | 'port' }>

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
/** 10° above the horizon. */
const MAX_POLAR_ANGLE = MathUtils.degToRad(80)
/** The longest step, in seconds, the keys move the camera by in one frame. */
const MAX_DRIVE_STEP = 0.1
const START_AZIMUTH = MathUtils.degToRad(34)
const START_POLAR_ANGLE = MathUtils.degToRad(55)
/** How far the camera target may leave the city's edge. */
const TARGET_MARGIN = 20
/** A building this close to the pointer, in CSS pixels, is under it. */
const PICK_SLACK = 8
/**
 * Boats and arcs move at 30 frames a second at most: every other frame at 60 Hz, a little under
 * 1/30 s so that a frame a hair early does not wait for the next.
 */
const ANIMATION_FRAME = 1000 / 30 - 4
/** Boats sail only while one at the camera's target spans this many device pixels or more. */
const SAIL_PIXELS = 3
/** The pointer this close to a bundle's hub, in CSS pixels, is on it, */
const HUB_SLACK = 14
/** and so does the pointer on its count, a pill at most this wide. */
const HUB_LABEL_HALF_WIDTH = 40
/**
 * The arcs' dashes move only while a period at the camera's target spans this many device pixels
 * or more: shorter, they have filled in (`SOLID_BELOW` of the arcs).
 */
const DASH_PIXELS = 6

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
  private readonly controls: CityControls
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
  private fleet: Fleet | null = null
  // Boats and arcs move together, on one clock: never more than 30 frames a second between them.
  private animatedAt = Number.NEGATIVE_INFINITY
  private readonly lessMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  private interaction: CityInteraction | null = null
  private listeners: CityListeners = {}
  private readonly raycaster = new Raycaster()
  private readonly ndc = new Vector2()
  private readonly bufferSize = new Vector2()
  private readonly projected = new Vector3()
  // Where the pointer is on the canvas, in CSS pixels; null when it is elsewhere.
  private pointer: { x: number; y: number; clientX: number; clientY: number } | null = null
  private pressedAt: { x: number; y: number } | null = null
  private cameraMoving = false
  private drive: Drive = STILL
  private readonly removeListeners: () => void

  constructor(container: HTMLElement, { continuous = false }: CityEngineOptions = {}) {
    this.continuous = continuous
    this.renderer = new WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      // The outline of a marked building is cut out with the stencil.
      stencil: true,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFShadowMap
    // The sun is fixed and the city does not move: the shadow map is drawn once per city
    // (load), not on every frame the camera moves.
    this.renderer.shadowMap.autoUpdate = false
    container.append(this.renderer.domElement)

    this.scene.background = new Color(OPEN_SEA)
    this.camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 1, 1000)
    this.controls = new CityControls(this.camera, this.renderer.domElement)
    this.controls.minDistance = MIN_DISTANCE
    this.controls.maxPolarAngle = MAX_POLAR_ANGLE

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

  /** Moves the camera as the keys held down say, until told otherwise. */
  setDrive(drive: Drive): void {
    this.drive = drive
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
      this.showPointerOn(null)
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
        !isClick(pressed, { x: event.clientX, y: event.clientY })
      ) {
        return
      }
      move(event)
      const interaction = this.interaction
      const mark = this.markAtPointer()
      // A click on a port's badge opens it, or closes it if open; any other click closes the
      // port open, and does nothing else.
      if (mark?.kind === 'port') {
        if (interaction?.openedPort === mark.port) {
          interaction.closePort()
        } else {
          interaction?.openPort(mark.port, this.badgeOnPage(mark.port))
        }
        this.hoverAtPointer()
        return
      }
      if (interaction?.openedPort) {
        interaction.closePort()
        this.hoverAtPointer()
        return
      }
      // A click on a bundle's hub opens it; on the sea, it clears the selection.
      if (mark?.kind === 'hub') {
        interaction?.openHub(mark.hub)
        this.hoverAtPointer()
        return
      }
      interaction?.select(this.pick())
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
    // The angle a few pixels span, at the middle of the view.
    const perPixel = (2 * Math.tan(MathUtils.degToRad(this.camera.fov) / 2)) / canvas.clientHeight
    const target = this.picker.pick(
      {
        origin: [origin.x, origin.y, origin.z],
        direction: [direction.x, direction.y, direction.z],
      },
      PICK_SLACK * perPixel,
    )
    this.stats.pickMs = performance.now() - started
    return target
  }

  private hoverAtPointer(): void {
    const pointer = this.pointer
    if (pointer) {
      const mark = this.markAtPointer()
      this.showPointerOn(mark)
      this.interaction?.point(mark ?? this.pick(), { x: pointer.clientX, y: pointer.clientY })
    }
  }

  /** Over a hub or a port's badge, the pointer says it can be clicked. */
  private showPointerOn(mark: Mark | null): void {
    this.renderer.domElement.style.cursor = mark ? 'pointer' : ''
  }

  /**
   * The bundle's hub or the port under the pointer, or under it its count, if any; a hub first,
   * it floats over the city.
   */
  private markAtPointer(): Mark | null {
    const interaction = this.interaction
    if (!interaction) {
      return null
    }
    const hub = this.nearestAtPointer(
      interaction.getHubs(),
      (hub) => hub.position,
      HUB_LABEL_HALF_WIDTH,
    )
    if (hub) {
      return { kind: 'hub', hub }
    }
    const port = this.nearestAtPointer(interaction.getPorts(), portBadgeAt, BADGE_HALF_WIDTH)
    return port ? { kind: 'port', port } : null
  }

  /** The item whose point, or the pill above it, is nearest the pointer, within reach. */
  private nearestAtPointer<T>(
    items: readonly T[],
    position: (item: T) => Vec3,
    labelHalfWidth: number,
  ): T | null {
    const pointer = this.pointer
    const canvas = this.renderer.domElement
    if (!pointer || canvas.clientWidth === 0) {
      return null
    }
    const projected = this.projected
    let nearest = HUB_SLACK
    let found: T | null = null
    for (const item of items) {
      projected.set(...position(item)).project(this.camera)
      if (projected.z > 1) {
        continue
      }
      const x = ((projected.x + 1) / 2) * canvas.clientWidth
      const y = ((1 - projected.y) / 2) * canvas.clientHeight
      const onLabel =
        Math.abs(pointer.x - x) <= labelHalfWidth &&
        y - pointer.y >= LABEL_LIFT &&
        y - pointer.y <= LABEL_LIFT + LABEL_HEIGHT
      const distance = onLabel ? 0 : Math.hypot(x - pointer.x, y - pointer.y)
      if (distance <= nearest) {
        nearest = distance
        found = item
      }
    }
    return found
  }

  /** One of the open port's links stands out, or none does. */
  focusPortLink(index: number | null): void {
    this.interaction?.focusPortLink(index)
  }

  closePort(): void {
    this.interaction?.closePort()
  }

  /** Opens the port of an island, if it has one, its card beside its badge. */
  openPortOf(island: number): void {
    const interaction = this.interaction
    const port = interaction?.getPorts().find((each) => each.island === island)
    if (!interaction || !port) {
      return
    }
    // The camera may have been moved since the last frame: it is where it goes.
    this.controls.update(0)
    this.camera.updateMatrixWorld()
    interaction.openPort(port, this.badgeOnPage(port))
  }

  /** Where a port's badge stands on the page, in its pixels; null out of the view. */
  private badgeOnPage(port: Port): { x: number; y: number } | null {
    const canvas = this.renderer.domElement
    const projected = this.projected.set(...portBadgeAt(port)).project(this.camera)
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    const x = ((projected.x + 1) / 2) * width
    const y = ((1 - projected.y) / 2) * height
    // In view while some of its pill is, even with its point past the edge.
    if (projected.z > 1 || !badgeInView(x, y, width, height)) {
      return null
    }
    const box = canvas.getBoundingClientRect()
    return { x: box.left + x, y: box.top + y }
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
    const fleet = new Fleet(
      links.boats.filter((boat) => boat.line),
      links.ferries,
      fading,
    )
    this.fleet = fleet
    this.animatedAt = Number.NEGATIVE_INFINITY
    this.picker = new CityPicker(shapes, buildings.placed)
    const interaction = new CityInteraction(
      layout,
      shapes,
      buildings,
      {
        imports: indexImports(layout),
        cycles: indexCycles(layout),
        bridges: links.bridges,
        ferries: links.ferries,
        unshown: links.unshown,
        extra: new ExtraFerries(layout, shapes, links),
        ports: links.ports,
      },
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
      createFerries(links.ferries, pixelRatio),
      buildings.group,
      createDecor(
        decor,
        links.boats.filter((boat) => !boat.line),
        fading,
      ),
      fleet.mesh,
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
    this.fleet = null
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

  /**
   * Whether the boats sail: not when the system asks for less motion, nor when they are too small
   * to see (a hidden tab gets no frames at all).
   */
  private boatsSail(): boolean {
    return !this.lessMotion.matches && BOAT_LENGTH * this.pixelsPerUnit() >= SAIL_PIXELS
  }

  /** How many device pixels one u spans at the camera's target. */
  private pixelsPerUnit(): number {
    const height = this.renderer.getDrawingBufferSize(this.bufferSize).y
    return (height * this.camera.projectionMatrix.elements[5]) / 2 / this.controls.distance
  }

  private frame(time: number): void {
    this.timer.update(time)
    const delta = this.timer.getDelta()
    // A frame late by more than this (a hidden tab, a long task) does not throw the camera away.
    this.controls.drive(this.drive, Math.min(delta, MAX_DRIVE_STEP))
    const moved = this.controls.update(delta)
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
    const tick = time - this.animatedAt >= ANIMATION_FRAME
    let animated = false
    const arcs = this.interaction?.arcs
    if (arcs?.grows) {
      arcs.grow(time, this.lessMotion.matches)
      this.needsRender = true
    }
    if (arcs?.moves) {
      // Still when the system asks for less motion: drawn once, their way shown by two spots.
      const still = this.lessMotion.matches
      const seen = DASH_PERIOD * this.pixelsPerUnit() >= DASH_PIXELS
      if (still !== arcs.still || (!still && seen && tick)) {
        arcs.update(time / 1000, still)
        animated = true
      }
    }
    if (this.fleet?.sails && tick && this.boatsSail()) {
      this.fleet.update(time / 1000)
      animated = true
    }
    if (animated) {
      this.animatedAt = time
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
      // An open port's card keeps beside its badge.
      const port = this.interaction?.openedPort
      if (port) {
        this.interaction?.movePort(this.badgeOnPage(port))
      }
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
