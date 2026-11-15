import type { PlacedBuilding } from '../buildings/placed-buildings'
import type { CityTarget } from '../interaction/picking'
import type { CityLayout, Rect } from '../world/layout'
import { boardToThree, type Vec3 } from '../world/units'

/** A file is framed with its neighbours, about five lots around it, whatever its size. */
const BLOCK_RADIUS = 10
/** Room around a folder the camera frames, in u: a lot and a half. */
export const FRAME_MARGIN = 3
/** Narrower than this share of the canvas, the room left of a panel is ignored. */
const MIN_FREE_SHARE = 0.4
/** Between two panels, narrower than this share. */
const MIN_BETWEEN_SHARE = 0.3
/** Room kept between a revealed selection and the panel, or the canvas's left edge, in px. */
const REVEAL_MARGIN = 24

/** Where a file or a folder stands, on the ground, in three.js coordinates. */
export interface Extent {
  centre: Vec3
  /** Half its width on the ground, in u. */
  radius: number
  /** Its top, in u above the ground: a building's roof; 0 for a folder. */
  height: number
  folder: boolean
}

/** Where the building of a file or the island or parcel of a folder stands; null for none. */
export function extentOf(
  target: CityTarget,
  layout: CityLayout,
  placed: readonly PlacedBuilding[],
): Extent | null {
  switch (target.kind) {
    case 'building': {
      const building = placed[target.index]
      if (!building) {
        return null
      }
      const { side, height } = building.building
      // A roof rises at most about a side above the walls.
      return { centre: building.position, radius: side / 2, height: height + side, folder: false }
    }
    case 'island': {
      const island = layout.islands[target.island]
      return island ? rectExtent(island.plateau) : null
    }
    case 'parcel': {
      const parcel = layout.islands[target.island]?.parcels[target.parcel]
      return parcel ? rectExtent(parcel.rect) : null
    }
  }
}

function rectExtent({ x, y, width, height }: Rect): Extent {
  return {
    centre: boardToThree(x + width / 2, y + height / 2, 0),
    radius: Math.hypot(width, height) / 2,
    height: 0,
    folder: true,
  }
}

/** The radius of the sphere a flight frames: a file with its block, a folder whole. */
export function flightRadius({ radius, height, folder }: Extent): number {
  return folder ? radius + FRAME_MARGIN : Math.max(BLOCK_RADIUS, height + radius)
}

/**
 * The sphere that frames several files and folders together: around all their extents, each
 * with the room a flight to it alone would give, and with files, never tighter than a flight to
 * one of them. Null for none.
 */
export function unionSphere(extents: readonly Extent[]): { centre: Vec3; radius: number } | null {
  const [first] = extents
  if (first === undefined) {
    return null
  }
  if (extents.length === 1) {
    return { centre: first.centre, radius: flightRadius(first) }
  }
  const xs = extents.flatMap(({ centre: [x], radius }) => [x - radius, x + radius])
  const zs = extents.flatMap(({ centre: [, , z], radius }) => [z - radius, z + radius])
  const centre: Vec3 = [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    0,
    (Math.min(...zs) + Math.max(...zs)) / 2,
  ]
  // Files close together are framed no tighter than one of them alone: with their block.
  const files = extents.some((extent) => !extent.folder)
  const radius = Math.max(
    files ? BLOCK_RADIUS : 0,
    ...extents.map(
      (extent) =>
        Math.hypot(extent.centre[0] - centre[0], extent.centre[2] - centre[2]) +
        Math.max(extent.radius + FRAME_MARGIN, extent.folder ? 0 : extent.height),
    ),
  )
  return { centre, radius }
}

/** The canvas, in CSS pixels, and the panels that cover its sides. */
export interface Viewport {
  width: number
  height: number
  /** Pixels a panel covers on the right of the canvas; 0 for none. */
  inset: number
  /** Pixels a panel covers on the left of the canvas; 0 for none. */
  left: number
  /** Vertical field of view, in degrees. */
  fov: number
}

/**
 * The part of the canvas the panels leave free, in pixels: where it starts from the left edge,
 * and its width. Between two panels it may be narrower than beside one; too narrow, the right
 * panel is ignored and the left one (the tour) stays clear, then both are.
 */
function freeSpan({ width, inset, left }: Viewport): { start: number; free: number } {
  const right = Math.max(inset, 0)
  const start = Math.max(left, 0)
  const both = width - right - start
  if (both >= width * (right > 0 && start > 0 ? MIN_BETWEEN_SHARE : MIN_FREE_SHARE)) {
    return { start, free: both }
  }
  if (start > 0 && width - start >= width * MIN_FREE_SHARE) {
    return { start, free: width - start }
  }
  return { start: 0, free: width - right < width * MIN_FREE_SHARE ? width : width - right }
}

/** The width of the part of the canvas the panels leave free, in pixels. */
export function freeWidth(viewport: Viewport): number {
  return freeSpan(viewport).free
}

/** Where that part starts, in pixels from the canvas's left edge. */
export function freeStart(viewport: Viewport): number {
  return freeSpan(viewport).start
}

/**
 * How far from a sphere the camera stands to see it whole in the free part of the canvas, and
 * how far to the right, in u, it looks past the sphere's centre so the centre lands in the middle
 * of that part.
 */
export function frameInView(
  radius: number,
  viewport: Viewport,
): { distance: number; shift: number } {
  const { width, height, fov } = viewport
  const free = freeWidth(viewport)
  const start = freeStart(viewport)
  const tanV = Math.tan((fov * Math.PI) / 360)
  const tanH = (tanV * free) / height
  const distance = radius / Math.sin(Math.atan(Math.min(tanV, tanH)))
  // At that distance, a pixel spans this many u.
  const perPixel = (2 * distance * tanV) / height
  return { distance, shift: (width / 2 - start - free / 2) * perPixel }
}

/**
 * How many pixels to slide a selection left, the span it covers on screen given, to clear the
 * panel: just enough, without pushing it off the left edge. One too wide to clear comes to the
 * middle of the free part, if it was right of it. 0 when it does not reach under the panel.
 */
export function revealShift(left: number, right: number, viewport: Viewport): number {
  const free = freeWidth(viewport)
  if (free === viewport.width) {
    return 0
  }
  const start = freeStart(viewport)
  const end = start + free
  const centre = (left + right) / 2
  // Only what the panel hides: a selection clear of it, or off screen, stays where it is.
  if (right <= end || centre > viewport.width) {
    return 0
  }
  const clear = right - end + REVEAL_MARGIN
  const room = left - start - REVEAL_MARGIN
  return clear <= room ? clear : Math.max(0, centre - start - free / 2)
}

/** After a flight, the camera goes round what it framed once in this many seconds. */
export const ORBIT_SECONDS = 60

/**
 * Where a point on the ground goes when it turns `angle` radians about the vertical through
 * `centre`, the way the camera's azimuth grows: what the camera looks at, as it goes round.
 */
export function turnAbout(
  [x, z]: readonly [number, number],
  [cx, cz]: readonly [number, number],
  angle: number,
): [number, number] {
  const dx = x - cx
  const dz = z - cz
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [cx + dx * cos + dz * sin, cz - dx * sin + dz * cos]
}

/** Going round, the camera rises this many radians at most above the tilt it flew in at, */
const ORBIT_RISE = (8 * Math.PI) / 180
/** comes down this many below it, towards the horizon, */
const ORBIT_FALL = (10 * Math.PI) / 180
/** and does both once in this many seconds: twice a turn. */
const ORBIT_SWELL_SECONDS = ORBIT_SECONDS / 2
/** Never closer to straight down than this, in radians from the vertical. */
const ORBIT_MIN_POLAR = (5 * Math.PI) / 180

/**
 * The tilt from the vertical `seconds` into a turn begun at `polar`: it rises towards the top
 * view, then comes down past where it began towards the horizon, and back, smoothly all along.
 * One wave, `mid − swing × cos(ωt − lag)`, set to start at `polar` and to span the rise and the
 * fall. The camera's own bound keeps the fall above the horizon.
 */
export function orbitTilt(polar: number, seconds: number): number {
  const mid = (ORBIT_FALL - ORBIT_RISE) / 2
  const swing = (ORBIT_FALL + ORBIT_RISE) / 2
  // At 0, cos(−lag) = mid / swing: the wave starts at 0, on its way up.
  const lag = Math.acos(mid / swing)
  const omega = (2 * Math.PI) / ORBIT_SWELL_SECONDS
  const offset = mid - swing * Math.cos(omega * seconds - lag)
  return Math.max(Math.min(polar, ORBIT_MIN_POLAR), polar + offset)
}
