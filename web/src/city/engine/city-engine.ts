import { Color, Group, PCFShadowMap, Scene, Timer, Vector3, WebGLRenderer } from 'three'
import { createBuildings } from '../buildings/buildings'
import type { PlacedBuilding } from '../buildings/placed-buildings'
import { cityDecor } from '../decor/decor'
import { BOAT_LENGTH, createDecor, type DecorStats, decorStats } from '../decor/decor-mesh'
import { Fleet } from '../decor/fleet'
import { indexCycles } from '../flows/cycles'
import { ExtraFerries } from '../flows/extra-ferries'
import { indexImports } from '../flows/selection-links'
import {
  type CameraView,
  CityInteraction,
  type CityItem,
  type CityListeners,
} from '../interaction/city-interaction'
import { CityPicker, type CityTarget } from '../interaction/picking'
import { type CityTargets, cityTargets } from '../interaction/targets'
import { DASH_PERIOD } from '../render/arc-mesh'
import { createFading } from '../render/dimming'
import { disposeObject } from '../render/dispose-object'
import { islandShapes } from '../terrain/island-shape'
import { createParcels } from '../terrain/plateaux'
import { createSea, OPEN_SEA, seaSize } from '../terrain/sea'
import { createTerrain } from '../terrain/terrain'
import { createBridges } from '../waterways/bridges'
import { createFerries } from '../waterways/ferries'
import { cityLinks } from '../waterways/links'
import type { CityLayout } from '../world/layout'
import { boardToThree } from '../world/units'
import { CameraRig } from './camera-rig'
import { CityPointer } from './city-pointer'
import { CitySun, SHADOW_MARGIN } from './city-sun'
import { type Drive, STILL } from './drive'
import { extentOf, FRAME_MARGIN, flightRadius } from './flight'
import { FrameCounter, type FrameStats, type LinkStats, NO_LINKS } from './frame-stats'

/**
 * Boats and arcs move at 30 frames a second at most: every other frame at 60 Hz, a little under
 * 1/30 s so that a frame a hair early does not wait for the next.
 */
const ANIMATION_FRAME = 1000 / 30 - 4
/** Boats sail only while one at the camera's target spans this many device pixels or more. */
const SAIL_PIXELS = 3
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
  private readonly rig: CameraRig
  private readonly sun: CitySun
  private readonly timer = new Timer()
  private readonly continuous: boolean
  private city: Group | null = null
  // Files per square unit of the plateaux, for the scale.
  private density = 0
  private targets: CityTargets | null = null
  private layout: CityLayout | null = null
  private placed: readonly PlacedBuilding[] = []
  private view: CameraView | null = null
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
  private cameraMoving = false
  private drive: Drive = STILL
  private readonly pointer: CityPointer

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
    this.rig = new CameraRig(this.renderer, this.lessMotion, () => {
      this.needsRender = true
    })

    this.sun = new CitySun(this.renderer, this.scene)

    this.pointer = new CityPointer(this.renderer.domElement, this.rig.camera, {
      interaction: () => this.interaction,
      picker: () => this.picker,
      cameraMoving: () => this.cameraMoving,
      stopOrbit: () => this.rig.stopOrbit(),
      select: (target) => this.select(target),
      fly: (target) => this.fly(target),
      pickTook: (ms) => {
        this.counter.stats.pickMs = ms
      },
    })
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
      this.rig.stopOrbit()
    }
    this.drive = drive
  }

  /**
   * Selects a building or a folder, or nothing. The camera stays, unless a panel hides the
   * selection: it then slides just clear of it.
   */
  select(target: CityTarget | null): void {
    this.rig.stopOrbit()
    this.interaction?.select(target)
    this.revealSelection()
  }

  /**
   * Pixels a panel covers on the right of the canvas, 0 for none: flights frame left of them, and
   * a selection they come to hide slides clear.
   */
  setViewInset(right: number): void {
    if (this.rig.setInset(right)) {
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
    this.rig.zoom(direction)
  }

  /** Frames the whole city again, at the same heading and tilt. */
  recenter(): void {
    this.rig.recenter()
  }

  /** Looks straight down, or back at the tilt it left. */
  toggleTopView(): void {
    this.rig.toggleTopView()
  }

  /** Turns to face north, the shorter way. */
  faceNorth(): void {
    this.rig.faceNorth()
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
    this.rig.frameSphere(centre, Math.hypot(maxX - minX, maxY - minY) / 2 + FRAME_MARGIN)
  }

  /** Flies to a file's building and its block, or to a folder whole, at the same heading and tilt. */
  private fly(target: CityTarget): void {
    const extent = this.layout && extentOf(target, this.layout, this.placed)
    if (extent) {
      this.rig.frameSphere(extent.centre, flightRadius(extent))
    }
  }

  /** Slides the camera sideways just enough for the selection to clear the panel that hides it. */
  private revealSelection(): void {
    const target = this.interaction?.getSelection()?.target
    this.rig.reveal((target && this.layout && extentOf(target, this.layout, this.placed)) || null)
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
    this.rig.settle()
    interaction.openPort(port, this.pointer.badgeOnPage(port))
  }

  /** Replaces the city on show and frames it. */
  load(layout: CityLayout): void {
    this.rig.stopOrbit()
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

    // The target stays between the sea and the highest plateau.
    const top = shapes.reduce((high, { altitudes }) => Math.max(high, altitudes[0] ?? 0), 0)
    this.rig.frameCity(centre, radius, bounds, top, seaSize(layout))
    this.renderer.shadowMap.needsUpdate = true
    this.needsRender = true
  }

  /** Points the camera at a board point from `distance` u away; angles in degrees if given. */
  lookAt(x: number, y: number, distance: number, azimuth?: number, polar?: number): void {
    const [tx, , tz] = boardToThree(x, y, 0)
    const radians = (degrees: number | undefined) =>
      degrees === undefined ? undefined : (degrees * Math.PI) / 180
    this.rig.lookAt(tx, tz, distance, radians(azimuth), radians(polar))
  }

  setSize(width: number, height: number): void {
    if (width === 0 || height === 0) {
      return
    }
    this.renderer.setSize(width, height)
    this.rig.resize(width, height)
    this.needsRender = true
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
    this.pointer.dispose()
    this.dropInteraction()
    this.rig.dispose()
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
    return !this.lessMotion.matches && BOAT_LENGTH * this.rig.pixelsPerUnit() >= SAIL_PIXELS
  }

  /** Tells the listeners where the camera looks from, when that changes. */
  private tellView(): void {
    if (!this.city) {
      return
    }
    const view = this.rig.view(this.density)
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

  private frame(time: number): void {
    this.timer.update(time)
    const delta = this.timer.getDelta()
    const moved = this.rig.step(delta, this.drive, this.picker)
    if (moved !== this.cameraMoving) {
      this.cameraMoving = moved
      // No card while the camera moves; once it rests, what lies under the pointer may differ.
      if (moved) {
        this.interaction?.clearHover()
      } else {
        this.pointer.hover()
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
      const seen = DASH_PERIOD * this.rig.pixelsPerUnit() >= DASH_PIXELS
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
      this.rig.fitNear()
      this.renderer.render(this.scene, this.rig.camera)
      this.needsRender = false
      // The view changes only with a frame drawn: the camera moved, or the window's size.
      this.tellView()
      // An open port's card keeps beside its badge.
      const port = this.interaction?.openedPort
      if (port) {
        this.interaction?.movePort(this.pointer.badgeOnPage(port))
      }
      this.counter.drawn(this.renderer.info, this.decor, this.links)
    }
    this.counter.tick(time)
  }
}
