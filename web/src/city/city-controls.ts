import CameraControls from 'camera-controls'
import type { PerspectiveCamera } from 'three'
import type { Drive } from './drive'
import { WheelSorter } from './wheel-gesture'

const { ACTION } = CameraControls

/**
 * Dragged up or down, the ground slides as far as the pointer would on it (the screen plane
 * leans away from it), but no more than this many times the drag: near the horizon, it would fly.
 */
const MAX_GROUND_STRETCH = 3
/** Held down, a key moves the target this much of the camera's distance in a second, */
const DRIVE_SPEED = 0.8
/** and turns the view this many radians. */
const TURN_SPEED = Math.PI / 2
/** One notch of a wheel zooms as much as camera-controls does; a pinch, this much more. */
const PINCH_SPEED = 2
const IS_MAC = /Mac/.test(globalThis.navigator?.platform ?? '')

/**
 * The city's camera moves like a map: the left button or two fingers on a trackpad drag the
 * ground, the right button (or the left one with Alt or Ctrl) turns and tilts, the wheel or a
 * pinch zooms to the pointer.
 */
export class CityControls extends CameraControls {
  private readonly sorter = new WheelSorter()
  private readonly removeListeners: () => void

  constructor(camera: PerspectiveCamera, canvas: HTMLElement) {
    super(camera, canvas)
    this.mouseButtons.left = ACTION.SCREEN_PAN
    this.mouseButtons.right = ACTION.ROTATE
    this.mouseButtons.middle = ACTION.DOLLY
    // The wheel is read here: camera-controls takes every wheel event for the same gesture.
    this.mouseButtons.wheel = ACTION.NONE
    this.touches.one = ACTION.TOUCH_SCREEN_PAN
    this.touches.two = ACTION.TOUCH_DOLLY_ROTATE
    this.touches.three = ACTION.TOUCH_SCREEN_PAN
    this.dollyToCursor = true

    const pan = this._truckInternal
    this._truckInternal = (deltaX, deltaY, dragToOffset, screenSpacePanning) => {
      const stretch = screenSpacePanning
        ? Math.min(1 / Math.cos(this.polarAngle), MAX_GROUND_STRETCH)
        : 1
      pan(deltaX, deltaY * stretch, dragToOffset, screenSpacePanning)
    }

    // Before camera-controls reads the buttons: capture listeners on the target run first.
    const down = (event: PointerEvent) => {
      this.mouseButtons.left = event.altKey || event.ctrlKey ? ACTION.ROTATE : ACTION.SCREEN_PAN
    }
    const wheel = (event: WheelEvent) => this.wheel(event)
    canvas.addEventListener('pointerdown', down, { capture: true })
    canvas.addEventListener('wheel', wheel, { passive: false })
    this.removeListeners = () => {
      canvas.removeEventListener('pointerdown', down, { capture: true })
      canvas.removeEventListener('wheel', wheel)
    }
  }

  /** Moves the target along the ground and turns around it, as keys held for `seconds` would. */
  drive({ right, forward, turn }: Drive, seconds: number): void {
    if (right === 0 && forward === 0 && turn === 0) {
      return
    }
    const step = DRIVE_SPEED * this.distance * seconds
    if (right !== 0) {
      void this.truck(right * step, 0, false)
    }
    if (forward !== 0) {
      void this.forward(forward * step, false)
    }
    if (turn !== 0) {
      void this.rotate(turn * TURN_SPEED * seconds, 0, false)
    }
  }

  override dispose(): void {
    this.removeListeners()
    super.dispose()
  }

  private wheel(event: WheelEvent): void {
    if (!this.enabled) {
      return
    }
    event.preventDefault()
    const gesture = this.sorter.sort(event, event.timeStamp)
    this._getClientRect(this._elementRect)
    if (gesture === 'scroll') {
      this._truckInternal(event.deltaX, event.deltaY, false, true)
      this._isUserControllingTruck = true
    } else {
      // As camera-controls reads a wheel's notches, and a pinch's steps.
      const lines = event.deltaMode === 1 && gesture === 'wheel'
      const factor = IS_MAC ? -1 : -3
      const delta = lines ? event.deltaY / factor : event.deltaY / (factor * 10)
      const rect = this._elementRect
      const x = ((event.clientX - rect.x) / rect.width) * 2 - 1
      const y = ((event.clientY - rect.y) / rect.height) * -2 + 1
      this._dollyInternal(-delta * (gesture === 'pinch' ? PINCH_SPEED : 1), x, y)
      this._isUserControllingDolly = true
    }
    this.dispatchEvent({ type: 'control' })
  }
}
