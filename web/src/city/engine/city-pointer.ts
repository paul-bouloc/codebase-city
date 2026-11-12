import { MathUtils, type PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three'
import { BADGE_HALF_WIDTH, badgeInView, portBadgeAt } from '../flows/port-links'
import type { CityInteraction } from '../interaction/city-interaction'
import { isClick, type Pointed } from '../interaction/city-items'
import type { CityPicker, CityTarget } from '../interaction/picking'
import { LABEL_HEIGHT, LABEL_LIFT } from '../render/arc-label'
import type { Port } from '../waterways/links'
import type { Vec3 } from '../world/units'

/** What a click opens: a bundle's hub, or a port. */
type Mark = Extract<Pointed, { kind: 'hub' | 'port' }>

/** A second click this soon after the first, in ms, and this close, in CSS pixels, flies there. */
const DOUBLE_CLICK_MS = 400
const DOUBLE_CLICK_SLACK = 6
/** A building this close to the pointer, in CSS pixels, is under it. */
const PICK_SLACK = 8
/** The pointer this close to a bundle's hub, in CSS pixels, is on it, */
const HUB_SLACK = 14
/** and so does the pointer on its count, a pill at most this wide. */
const HUB_LABEL_HALF_WIDTH = 40

/** What the pointer acts on, owned by the engine. */
export interface PointerHost {
  interaction(): CityInteraction | null
  picker(): CityPicker | null
  cameraMoving(): boolean
  stopOrbit(): void
  select(target: CityTarget | null): void
  fly(target: CityTarget): void
  /** The island or folder whose label is at this point of the canvas, in CSS pixels. */
  labelAt(x: number, y: number): CityTarget | null
  /** How long the last search for what the pointer rests on took, in ms. */
  pickTook(ms: number): void
}

/** The pointer on the city's canvas: what it hovers, what a click selects, opens or flies to. */
export class CityPointer {
  // Where the pointer is on the canvas, in CSS pixels; null when it is elsewhere.
  private pointer: { x: number; y: number; clientX: number; clientY: number } | null = null
  private pressedAt: { x: number; y: number } | null = null
  // The last click that selected, for a second one to fly there.
  private lastClick: { time: number; x: number; y: number } | null = null
  private readonly raycaster = new Raycaster()
  private readonly ndc = new Vector2()
  private readonly projected = new Vector3()
  private readonly removeListeners: () => void

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: PerspectiveCamera,
    private readonly host: PointerHost,
  ) {
    this.removeListeners = this.listen(canvas)
  }

  dispose(): void {
    this.removeListeners()
  }

  private listen(canvas: HTMLCanvasElement): () => void {
    const move = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect()
      this.pointer = {
        x: event.clientX - box.left,
        y: event.clientY - box.top,
        clientX: event.clientX,
        clientY: event.clientY,
      }
      // A button held down drags the camera: nothing is hovered meanwhile.
      if (event.buttons === 0 && !this.host.cameraMoving()) {
        this.hover()
      }
    }
    const stop = () => this.host.stopOrbit()
    const leave = () => {
      this.pointer = null
      this.showPointerOn(false)
      this.host.interaction()?.point(null, { x: 0, y: 0 })
    }
    const down = (event: PointerEvent) => {
      // Any press on the city takes the camera back: it stops going round.
      this.host.stopOrbit()
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
      const interaction = this.host.interaction()
      const mark = this.markAtPointer()
      // A click on a port's badge opens it, or closes it if open; any other click closes the
      // port open, and does nothing else.
      if (mark?.kind === 'port') {
        if (interaction?.openedPort === mark.port) {
          interaction.closePort()
        } else {
          interaction?.openPort(mark.port, this.badgeOnPage(mark.port))
        }
        this.hover()
        return
      }
      if (interaction?.openedPort) {
        interaction.closePort()
        this.hover()
        return
      }
      // A click on a bundle's hub opens it; on the sea, it clears the selection.
      if (mark?.kind === 'hub') {
        interaction?.openHub(mark.hub)
        this.hover()
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
          this.host.fly(selected.target)
        }
        return
      }
      this.lastClick = click
      this.host.select(this.pick())
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

  /** What is under the pointer, if anything: a label first, it stands over the city. */
  private pick(): CityTarget | null {
    const pointer = this.pointer
    const picker = this.host.picker()
    const canvas = this.canvas
    if (!pointer || !picker || canvas.clientWidth === 0 || canvas.clientHeight === 0) {
      return null
    }
    const labelled = this.host.labelAt(pointer.x, pointer.y)
    if (labelled) {
      return labelled
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
    const target = picker.pick(
      {
        origin: [origin.x, origin.y, origin.z],
        direction: [direction.x, direction.y, direction.z],
      },
      PICK_SLACK * perPixel,
    )
    this.host.pickTook(performance.now() - started)
    return target
  }

  /** Hovers what lies under the pointer, if it is on the canvas. */
  hover(): void {
    const pointer = this.pointer
    if (pointer) {
      const mark = this.markAtPointer()
      this.showPointerOn(mark !== null || this.host.labelAt(pointer.x, pointer.y) !== null)
      this.host
        .interaction()
        ?.point(mark ?? this.pick(), { x: pointer.clientX, y: pointer.clientY })
    }
  }

  /** Over a hub, a port's badge or a label, the pointer says it can be clicked. */
  private showPointerOn(clickable: boolean): void {
    this.canvas.style.cursor = clickable ? 'pointer' : ''
  }

  /**
   * The bundle's hub or the port under the pointer, or under it its count, if any; a hub first,
   * it floats over the city.
   */
  private markAtPointer(): Mark | null {
    const interaction = this.host.interaction()
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
    const canvas = this.canvas
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

  /** Where a port's badge stands on the page, in its pixels; null out of the view. */
  badgeOnPage(port: Port): { x: number; y: number } | null {
    const canvas = this.canvas
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
}
