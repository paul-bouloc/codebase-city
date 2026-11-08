import CameraControls from 'camera-controls'
import {
  Box3,
  MathUtils,
  Matrix4,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Sphere,
  Spherical,
  Vector2,
  Vector3,
  Vector4,
  type WebGLRenderer,
} from 'three'
import type { CameraView } from '../interaction/city-interaction'
import type { CityPicker } from '../interaction/picking'
import type { Rect } from '../world/layout'
import { nearPlane, type Vec3 } from '../world/units'
import { CityControls } from './city-controls'
import type { Drive } from './drive'
import {
  type Extent,
  frameInView,
  ORBIT_SECONDS,
  orbitTilt,
  revealShift,
  turnAbout,
  type Viewport,
} from './flight'
import { bearingOf, northOf, scaleFiles } from './map-scale'
import { maxTilt, NEAR_TILT } from './tilt'

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
export const MIN_DISTANCE = 6
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

/**
 * The camera and its controls: how it frames the city, flies, goes round what it flew to, and
 * keeps clear of the ground and of the panel beside the canvas.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera
  private readonly controls: CityControls
  // The sphere the camera frames the city with, once a city is loaded.
  private framing: Sphere | null = null
  // The distance the camera frames it from, whatever the window's shape.
  private framingDistance = 0
  // Pixels a panel covers on the right of the canvas: the camera frames and reveals left of them.
  private inset = 0
  // Where the camera's target may go: between the sea and the highest plateau, around the city.
  private readonly boundary = new Box3()
  // What the camera goes round, from the moment it flies there until the next gesture,
  // with the tilt it flew in at and how long it has gone round.
  private orbit: { centre: Vec3; polar: number; seconds: number } | null = null
  // The tilt the top view left, to go back to.
  private tiltBeforeTop = START_POLAR_ANGLE
  private readonly bufferSize = new Vector2()
  private readonly projected = new Vector3()
  private readonly aimedAt = new Vector3()
  // Where the camera is going, not where its move has brought it so far.
  private readonly heading = new Spherical()

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly lessMotion: MediaQueryList,
    private readonly requestRender: () => void,
  ) {
    this.camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 1, 1000)
    this.controls = new CityControls(this.camera, renderer.domElement)
    this.controls.minDistance = MIN_DISTANCE
    this.controls.maxPolarAngle = NEAR_TILT
  }

  /** Frames a new city whole, from the starting heading and tilt. */
  frameCity(centre: Vector3, radius: number, bounds: Rect, top: number, far: number): void {
    this.camera.far = far
    this.camera.updateProjectionMatrix()
    const framing = new Sphere(centre, Math.max(radius, MIN_DISTANCE))
    this.framing = framing
    this.fitMaxDistance()
    // The target stays between the sea and the highest plateau: zooming to the cursor would
    // otherwise drag it, and the camera with it, under the water. Each frame sets it on the ground.
    const { x: cx, z: cz } = centre
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
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    // A portrait window needs more room to see the whole city than the one it loaded in.
    this.fitMaxDistance()
  }

  /** Sets the pixels a panel covers on the right of the canvas; true when it grew. */
  setInset(right: number): boolean {
    const grew = right > this.inset
    this.inset = right
    return grew
  }

  stopOrbit(): void {
    this.orbit = null
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

  /** Points the camera at a point of the scene from `distance` u away; angles in radians if given. */
  lookAt(x: number, z: number, distance: number, azimuth?: number, polar?: number): void {
    this.stopOrbit()
    if (azimuth !== undefined && polar !== undefined) {
      void this.controls.rotateTo(azimuth, polar, false)
    }
    void this.controls.moveTo(x, 0, z, false)
    void this.controls.dollyTo(distance, false)
    this.requestRender()
  }

  /**
   * Frames a sphere on the ground in the part of the canvas no panel covers, then goes round it,
   * slowly, until the next gesture; never with less motion asked for.
   */
  frameSphere(centre: Vec3, radius: number): void {
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
    this.requestRender()
  }

  /** Slides the camera sideways just enough for `extent` to clear the panel that hides it. */
  reveal(extent: Extent | null): void {
    const canvas = this.renderer.domElement
    if (!extent || this.inset <= 0 || canvas.clientHeight === 0) {
      return
    }
    // The camera may have been moved since the last frame: it is where it goes.
    this.settle()
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
    this.requestRender()
  }

  /** Brings the camera to where its move goes now, between two frames. */
  settle(): void {
    this.controls.update(0)
    this.camera.updateMatrixWorld()
  }

  /**
   * Moves the camera by a frame of `delta` seconds: the keys held down, the turn about what it
   * flew to, the tilt its distance and the ground allow. True when it moved.
   */
  step(delta: number, drive: Drive, picker: CityPicker | null): boolean {
    // A frame late by more than this (a hidden tab, a long task) does not throw the camera away.
    this.controls.drive(drive, Math.min(delta, MAX_DRIVE_STEP))
    this.goRound(Math.min(delta, MAX_DRIVE_STEP))
    // Further away, the camera may come down closer to the horizon,
    let tilt = maxTilt(this.controls.distance, MIN_DISTANCE, this.framingDistance)
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
    return this.controls.update(delta)
  }

  /** Brings the near plane in or out with the distance, before a frame is drawn. */
  fitNear(): void {
    const near = nearPlane(this.controls.distance)
    if (near !== this.camera.near) {
      this.camera.near = near
      this.camera.updateProjectionMatrix()
    }
  }

  /** Where the camera looks from, for a city of `density` files per square unit. */
  view(density: number): CameraView {
    return {
      bearing: bearingOf(this.controls.azimuthAngle),
      topView: this.controls.polarAngle <= TOP_VIEW_POLAR,
      scaleFiles: scaleFiles(this.pixelsPerUnit() / this.renderer.getPixelRatio(), density),
    }
  }

  /** How many device pixels one u spans at the camera's target. */
  pixelsPerUnit(): number {
    const height = this.renderer.getDrawingBufferSize(this.bufferSize).y
    return (height * this.camera.projectionMatrix.elements[5]) / 2 / this.controls.distance
  }

  dispose(): void {
    this.controls.dispose()
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

  private fitMaxDistance(): void {
    if (this.framing !== null) {
      this.framingDistance = this.controls.getDistanceToFitSphere(this.framing.radius)
      this.controls.maxDistance = MAX_FRAMING * this.framingDistance
    }
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
}
