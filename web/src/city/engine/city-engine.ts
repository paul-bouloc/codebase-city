import CameraControls from 'camera-controls'
import {
  Box3,
  Color,
  Group,
  MathUtils,
  Matrix4,
  PCFShadowMap,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Scene,
  Sphere,
  Spherical,
  Timer,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three'
import { createBuildings } from '../buildings/buildings'
import type { PlacedBuilding } from '../buildings/placed-buildings'
import { cityDecor } from '../decor/decor'
import { BOAT_LENGTH, createDecor, type DecorStats, decorStats } from '../decor/decor-mesh'
import { Fleet } from '../decor/fleet'
import { indexCycles } from '../flows/cycles'
import { ExtraFerries } from '../flows/extra-ferries'
import { BADGE_HALF_WIDTH, badgeInView, portBadgeAt } from '../flows/port-links'
import { indexImports } from '../flows/selection-links'
import {
  type CameraView,
  CityInteraction,
  type CityItem,
  type CityListeners,
  isClick,
  type Pointed,
} from '../interaction/city-interaction'
import { CityPicker, type CityTarget } from '../interaction/picking'
import { type CityTargets, cityTargets } from '../interaction/targets'
import { DASH_PERIOD, LABEL_HEIGHT, LABEL_LIFT } from '../render/arc-mesh'
import { createFading } from '../render/dimming'
import { disposeObject } from '../render/dispose-object'
import { islandShapes } from '../terrain/island-shape'
import { createParcels } from '../terrain/plateaux'
import { createSea, OPEN_SEA, seaSize } from '../terrain/sea'
import { createTerrain } from '../terrain/terrain'
import { createBridges } from '../waterways/bridges'
import { createFerries } from '../waterways/ferries'
import { cityLinks, type Port } from '../waterways/links'
import type { CityLayout } from '../world/layout'
import { boardToThree, nearPlane, type Vec3 } from '../world/units'
import { CityControls } from './city-controls'
import { CitySun, SHADOW_MARGIN } from './city-sun'
import { type Drive, STILL } from './drive'
import {
  extentOf,
  FRAME_MARGIN,
  flightRadius,
  frameInView,
  ORBIT_SECONDS,
  orbitTilt,
  revealShift,
  turnAbout,
  type Viewport,
} from './flight'
import { FrameCounter, type FrameStats, type LinkStats, NO_LINKS } from './frame-stats'
import { bearingOf, northOf, scaleFiles } from './map-scale'
import { maxTilt, NEAR_TILT } from './tilt'

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
/** How high above the ground under it the camera stays, in u. */
const CAMERA_CLEARANCE = 0.5
/** The longest step, in seconds, the keys move the camera by in one frame. */
const MAX_DRIVE_STEP = 0.1
const START_AZIMUTH = MathUtils.degToRad(34)
const START_POLAR_ANGLE = MathUtils.degToRad(55)
/** A button's zoom: the distance divided or multiplied by this. */
const ZOOM_STEP = 1.6
/** Closer to the vertical than this, the camera looks straight down. */
const TOP_VIEW_POLAR = MathUtils.degToRad(1)
/** How far the camera target may leave the city's edge. */
const TARGET_MARGIN = 20
/** A second click this soon after the first, in ms, and this close, in CSS pixels, flies there. */
const DOUBLE_CLICK_MS = 400
const DOUBLE_CLICK_SLACK = 6
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
  private readonly sun: CitySun
  private readonly timer = new Timer()
  private readonly continuous: boolean
  private city: Group | null = null
  // The sphere the camera frames the city with, once a city is loaded.
  private framing: Sphere | null = null
  // Files per square unit of the plateaux, for the scale.
  private density = 0
  private targets: CityTargets | null = null
  private layout: CityLayout | null = null
  private placed: readonly PlacedBuilding[] = []
  // Pixels a panel covers on the right of the canvas: the camera frames and reveals left of them.
  private inset = 0
  // Where the camera's target may go: between the sea and the highest plateau, around the city.
  private readonly boundary = new Box3()
  // What the camera goes round, from the moment it flies there until the next gesture,
  // with the tilt it flew in at and how long it has gone round.
  private orbit: { centre: Vec3; polar: number; seconds: number } | null = null
  // The last click that selected, for a second one to fly there.
  private lastClick: { time: number; x: number; y: number } | null = null
  // The tilt the top view left, to go back to.
  private tiltBeforeTop = START_POLAR_ANGLE
  private view: CameraView | null = null
  // The distance the camera frames it from, whatever the window's shape.
  private framingDistance = 0
  private needsRender = true
  private decor: DecorStats = { instances: 0, triangles: 0 }
  private links: LinkStats = NO_LINKS
  private readonly counter = new FrameCounter()
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
  private readonly aimedAt = new Vector3()
  // Where the camera is going, not where its move has brought it so far.
  private readonly heading = new Spherical()
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
    this.controls.maxPolarAngle = NEAR_TILT

    this.sun = new CitySun(this.renderer, this.scene)

    this.removeListeners = this.listenToPointer(this.renderer.domElement)
    this.setSize(container.clientWidth, container.clientHeight)
    this.renderer.setAnimationLoop((time) => this.frame(time))
  }

  /** Who hears of hover cards and selections. */
  setListeners(listeners: CityListeners): void {
    this.listeners = listeners
    // The new listeners hear of the view at the next frame drawn.
    this.view = null
    this.needsRender = true
  }

  /** Moves the camera as the keys held down say, until told otherwise. */
  setDrive(drive: Drive): void {
    if (drive.right !== 0 || drive.forward !== 0 || drive.turn !== 0) {
      this.stopOrbit()
    }
    this.drive = drive
  }

  /**
   * Selects a building or a folder, or nothing. The camera stays, unless a panel hides the
   * selection: it then slides just clear of it.
   */
  select(target: CityTarget | null): void {
    this.stopOrbit()
    this.interaction?.select(target)
    this.revealSelection()
  }

  /**
   * Pixels a panel covers on the right of the canvas, 0 for none: flights frame left of them, and
   * a selection they come to hide slides clear.
   */
  setViewInset(right: number): void {
    const grew = right > this.inset
    this.inset = right
    if (grew) {
      this.revealSelection()
    }
  }

  /** Selects the building of a file or the island or parcel of a folder, and flies to it. */
  flyTo(path: string): boolean {
    const target = this.targets?.at(path) ?? null
    if (target) {
      this.interaction?.select(target)
      this.fly(target)
    }
    return target !== null
  }

  clearSelection(): void {
    this.select(null)
  }

  getSelection(): CityItem | null {
    return this.interaction?.getSelection() ?? null
  }

  /** Selects the building of a file or the island or parcel of a folder; false for none. */
  selectPath(path: string): boolean {
    const target = this.targets?.at(path) ?? null
    if (target) {
      this.select(target)
    }
    return target !== null
  }

  /** Comes closer (1) or pulls back (-1) by a button's step, around the same target. */
  zoom(direction: 1 | -1): void {
    this.stopOrbit()
    // From where a zoom under way ends: quick presses add up to whole steps.
    const { radius } = this.controls.getSpherical(this.heading, true)
    void this.controls.dollyTo(radius * ZOOM_STEP ** -direction, true)
  }

  /** Frames the whole city again, at the same heading and tilt. */
  recenter(): void {
    this.stopOrbit()
    if (this.framing) {
      void this.controls.fitToSphere(this.framing, true)
    }
  }

  /** Looks straight down, or back at the tilt it left. */
  toggleTopView(): void {
    this.stopOrbit()
    // Where a turn under way ends: a second press goes back, it does not keep the tilt halfway.
    const { theta, phi } = this.controls.getSpherical(this.heading, true)
    if (phi <= TOP_VIEW_POLAR) {
      void this.controls.rotateTo(theta, this.tiltBeforeTop, true)
    } else {
      this.tiltBeforeTop = phi
      void this.controls.rotateTo(theta, 0, true)
    }
  }

  /** Turns to face north, the shorter way. */
  faceNorth(): void {
    this.stopOrbit()
    const { theta, phi } = this.controls.getSpherical(this.heading, true)
    void this.controls.rotateTo(northOf(theta), phi, true)
  }

  /** Frames the lots of these files, at the same heading and tilt. */
  frameFiles(paths: readonly string[]): void {
    const points = paths.flatMap((path) => this.targets?.lotOf(path) ?? [])
    if (points.length === 0) {
      return
    }
    const xs = points.map(({ x }) => x)
    const ys = points.map(({ y }) => y)
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)]
    const [minY, maxY] = [Math.min(...ys), Math.max(...ys)]
    const centre = boardToThree((minX + maxX) / 2, (minY + maxY) / 2, 0)
    this.frameSphere(centre, Math.hypot(maxX - minX, maxY - minY) / 2 + FRAME_MARGIN)
  }

  /** Flies to a file's building and its block, or to a folder whole, at the same heading and tilt. */
  private fly(target: CityTarget): void {
    const extent = this.layout && extentOf(target, this.layout, this.placed)
    if (extent) {
      this.frameSphere(extent.centre, flightRadius(extent))
    }
  }

  private stopOrbit(): void {
    this.orbit = null
  }

  /**
   * Turns where the camera is going about what it goes round, for `seconds`, rising and coming
   * back down: the camera follows
   * with its usual smoothing, so the turn starts with the flight and blends into it.
   */
  private goRound(seconds: number): void {
    const orbit = this.orbit
    if (!orbit) {
      return
    }
    orbit.seconds += seconds
    const angle = ((2 * Math.PI) / ORBIT_SECONDS) * seconds
    const target = this.controls.getTarget(this.aimedAt, true)
    const [x, z] = turnAbout([target.x, target.z], [orbit.centre[0], orbit.centre[2]], angle)
    void this.controls.moveTo(x, target.y, z, true)
    // It rises and comes back down as it goes round.
    const { theta } = this.controls.getSpherical(this.heading, true)
    void this.controls.rotateTo(theta + angle, orbitTilt(orbit.polar, orbit.seconds), true)
  }

  /**
   * Frames a sphere on the ground in the part of the canvas no panel covers, then goes round it,
   * slowly, until the next gesture; never with less motion asked for.
   */
  private frameSphere(centre: Vec3, radius: number): void {
    this.stopOrbit()
    const canvas = this.renderer.domElement
    if (canvas.clientWidth === 0 || canvas.clientHeight === 0) {
      return
    }
    const [x, , z] = centre
    const { distance, shift } = frameInView(radius, this.viewport())
    // Beside a panel, the camera looks to one side of the centre; going round, anywhere on that
    // circle: the target may go there, even past the city's edge.
    this.allowTarget(x, z, shift)
    // The camera looks `shift` u to the right of the centre, at the heading it turns to.
    const { theta, phi } = this.controls.getSpherical(this.heading, true)
    const smooth = !this.lessMotion.matches
    void this.controls.moveTo(x + Math.cos(theta) * shift, 0, z - Math.sin(theta) * shift, smooth)
    void this.controls.dollyTo(distance, smooth)
    if (smooth) {
      this.orbit = { centre, polar: phi, seconds: 0 }
    }
    this.needsRender = true
  }

  /** Slides the camera sideways just enough for the selection to clear the panel that hides it. */
  private revealSelection(): void {
    const target = this.interaction?.getSelection()?.target
    const extent = target && this.layout && extentOf(target, this.layout, this.placed)
    const canvas = this.renderer.domElement
    if (!extent || this.inset <= 0 || canvas.clientHeight === 0) {
      return
    }
    // The camera may have been moved since the last frame: it is where it goes.
    this.controls.update(0)
    this.camera.updateMatrixWorld()
    const projected = this.projected.set(...extent.centre).project(this.camera)
    if (projected.z > 1 || Math.abs(projected.y) > 1) {
      return
    }
    // How far ahead of the camera, along its axis, the selection stands.
    const forward = this.camera.getWorldDirection(new Vector3())
    const depth = this.aimedAt
      .set(...extent.centre)
      .sub(this.camera.position)
      .dot(forward)
    const tanV = Math.tan(MathUtils.degToRad(this.camera.fov) / 2)
    const perPixel = (2 * depth * tanV) / canvas.clientHeight
    const x = ((projected.x + 1) / 2) * canvas.clientWidth
    const half = extent.radius / perPixel
    const pixels = revealShift(x - half, x + half, this.viewport())
    if (pixels <= 0) {
      return
    }
    const { theta } = this.controls.getSpherical(this.heading, true)
    const target3 = this.controls.getTarget(this.aimedAt, true)
    const shift = pixels * perPixel
    const x2 = target3.x + Math.cos(theta) * shift
    const z2 = target3.z - Math.sin(theta) * shift
    this.allowTarget(x2, z2, 0)
    void this.controls.moveTo(x2, target3.y, z2, !this.lessMotion.matches)
    this.needsRender = true
  }

  /**
   * Widens where the camera's target may go to the square around a point on the ground, `reach`
   * u on each side; never in height, which keeps it out of the sea. Until the next city.
   */
  private allowTarget(x: number, z: number, reach: number): void {
    const { min, max } = this.boundary
    if (min.x <= x - reach && max.x >= x + reach && min.z <= z - reach && max.z >= z + reach) {
      return
    }
    min.x = Math.min(min.x, x - reach)
    max.x = Math.max(max.x, x + reach)
    min.z = Math.min(min.z, z - reach)
    max.z = Math.max(max.z, z + reach)
    this.controls.setBoundary(this.boundary)
  }

  private viewport(): Viewport {
    const canvas = this.renderer.domElement
    return {
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      inset: this.inset,
      fov: this.camera.fov,
    }
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
    const stop = () => this.stopOrbit()
    const leave = () => {
      this.pointer = null
      this.showPointerOn(null)
      this.interaction?.point(null, { x: 0, y: 0 })
    }
    const down = (event: PointerEvent) => {
      // Any press on the city takes the camera back: it stops going round.
      this.stopOrbit()
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
      // Only two clicks in a row that select make a double click.
      const last = this.lastClick
      this.lastClick = null
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
      // A second click on the spot flies to what the first one selected: the camera may have
      // slid in between, so the pointer may now be on something else.
      const click = { time: event.timeStamp, x: event.clientX, y: event.clientY }
      if (
        last &&
        click.time - last.time <= DOUBLE_CLICK_MS &&
        Math.hypot(click.x - last.x, click.y - last.y) <= DOUBLE_CLICK_SLACK
      ) {
        const selected = interaction?.getSelection()
        if (selected) {
          this.fly(selected.target)
        }
        return
      }
      this.lastClick = click
      this.select(this.pick())
    }
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerleave', leave)
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('wheel', stop, { passive: true })
    canvas.addEventListener('pointerup', up)
    return () => {
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerleave', leave)
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('wheel', stop)
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
    this.counter.stats.pickMs = performance.now() - started
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
    this.stopOrbit()
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
    this.targets = cityTargets(layout)
    this.layout = layout
    this.placed = buildings.placed
    const files = layout.islands.reduce((sum, island) => sum + island.lots.length, 0)
    const area = layout.islands.reduce(
      (sum, { plateau }) => sum + plateau.width * plateau.height,
      0,
    )
    this.density = area > 0 ? files / area : 0
    this.view = null
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
    this.sun.fit(centre, radius + SHADOW_MARGIN)

    this.camera.far = seaSize(layout)
    this.camera.updateProjectionMatrix()
    const framing = new Sphere(centre, Math.max(radius, MIN_DISTANCE))
    this.framing = framing
    this.fitMaxDistance()
    // The target stays between the sea and the highest plateau: zooming to the cursor would
    // otherwise drag it, and the camera with it, under the water. Each frame sets it on the ground.
    const top = shapes.reduce((high, { altitudes }) => Math.max(high, altitudes[0] ?? 0), 0)
    const box = new Box3(
      new Vector3(cx - bounds.width / 2 - TARGET_MARGIN, 0, cz - bounds.height / 2 - TARGET_MARGIN),
      new Vector3(
        cx + bounds.width / 2 + TARGET_MARGIN,
        top,
        cz + bounds.height / 2 + TARGET_MARGIN,
      ),
    )
    this.boundary.copy(box)
    this.controls.setBoundary(box)
    void this.controls.rotateTo(START_AZIMUTH, START_POLAR_ANGLE, false)
    void this.controls.fitToSphere(framing, false)
    this.renderer.shadowMap.needsUpdate = true
    this.needsRender = true
  }

  /** Points the camera at a board point from `distance` u away; angles in degrees if given. */
  lookAt(x: number, y: number, distance: number, azimuth?: number, polar?: number): void {
    this.stopOrbit()
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
    if (this.framing !== null) {
      this.framingDistance = this.controls.getDistanceToFitSphere(this.framing.radius)
      this.controls.maxDistance = MAX_FRAMING * this.framingDistance
    }
  }

  getStats(): FrameStats {
    return this.counter.stats
  }

  /** How the city on show draws the imports between islands, as soon as it is loaded. */
  getLinkStats(): LinkStats {
    return this.links
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
    this.sun.dispose()
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
    this.targets = null
  }

  /**
   * Whether the boats sail: not when the system asks for less motion, nor when they are too small
   * to see (a hidden tab gets no frames at all).
   */
  private boatsSail(): boolean {
    return !this.lessMotion.matches && BOAT_LENGTH * this.pixelsPerUnit() >= SAIL_PIXELS
  }

  /** Tells the listeners where the camera looks from, when that changes. */
  private tellView(): void {
    if (!this.city) {
      return
    }
    const pixelRatio = this.renderer.getPixelRatio()
    const view: CameraView = {
      bearing: bearingOf(this.controls.azimuthAngle),
      topView: this.controls.polarAngle <= TOP_VIEW_POLAR,
      scaleFiles: scaleFiles(this.pixelsPerUnit() / pixelRatio, this.density),
    }
    const last = this.view
    if (
      !last ||
      last.bearing !== view.bearing ||
      last.topView !== view.topView ||
      last.scaleFiles !== view.scaleFiles
    ) {
      this.view = view
      this.listeners.view?.(view)
    }
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
    this.goRound(Math.min(delta, MAX_DRIVE_STEP))
    // Further away, the camera may come down closer to the horizon,
    let tilt = maxTilt(this.controls.distance, MIN_DISTANCE, this.framingDistance)
    const picker = this.picker
    if (picker) {
      // around a target on the ground, and never closer to the ground under it than this.
      const target = this.controls.getTarget(this.aimedAt, true)
      const ground = picker.groundHeight(target.x, target.z)
      this.controls.followGround(ground)
      const { x, z } = this.camera.position
      const rise = picker.groundHeight(x, z) + CAMERA_CLEARANCE - ground
      if (rise > 0) {
        tilt = Math.min(tilt, Math.acos(Math.min(rise / this.controls.distance, 1)))
      }
    }
    this.controls.limitTilt(tilt)
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
      // The view changes only with a frame drawn: the camera moved, or the window's size.
      this.tellView()
      // An open port's card keeps beside its badge.
      const port = this.interaction?.openedPort
      if (port) {
        this.interaction?.movePort(this.badgeOnPage(port))
      }
      this.counter.drawn(this.renderer.info, this.decor, this.links)
    }
    this.counter.tick(time)
  }
}
