import { Group, type Mesh, type ShaderMaterial } from 'three'
import { GUIDE } from '../render/palette'
import { createScreenDots } from '../render/screen-dots'
import { createScreenLines } from '../render/screen-lines'
import type { Point, Rect } from '../world/layout'
import { boardToThree, srgb, type Vec3 } from '../world/units'

// The ties between the islands of a unit the guide shows (the apps of a group, the islands of the
// root package): dotted Jade on the water, from shore to shore, the shortest that join them all.
// Dots, never a dashed line: they must not read as a ferry line.

/** How far out of its plateau a tie starts, in u. */
const SHORE_OUT = 1.2
/** Ties lie this high over the water, in u. */
const WATER_LIFT = 0.06
const WHITE: Vec3 = [1, 1, 1]
const HALO = { width: 7, colour: WHITE, opacity: 0.8 }
const DOTS = { width: 4, dots: 7.1 }
const END = { radius: 3.5, rim: { width: 1.2, colour: WHITE } }

/**
 * The ties between these plateaux: a minimum spanning tree over their middles, each tie from the
 * shore of one, where the line between their middles leaves it, to the shore of the other.
 */
export function guideTies(plateaux: readonly Rect[]): [Point, Point][] {
  const middles = plateaux.map(middleOf)
  const ties: [Point, Point][] = []
  const joined = plateaux.length > 0 ? [0] : []
  const left = new Set(plateaux.map((_, at) => at).slice(1))
  while (left.size > 0) {
    let best: [number, number, number] | null = null
    for (const a of joined) {
      for (const b of left) {
        const length = distance(middles[a], middles[b])
        if (!best || length < best[2]) {
          best = [a, b, length]
        }
      }
    }
    if (!best) {
      break
    }
    const [a, b] = best
    ties.push([shore(plateaux[a], middles[b]), shore(plateaux[b], middles[a])])
    joined.push(b)
    left.delete(b)
  }
  return ties
}

/** Where the line from a plateau's middle towards `to` crosses its shore. */
function shore(plateau: Rect | undefined, to: Point | undefined): Point {
  const from = plateau ? middleOf(plateau) : { x: 0, y: 0 }
  if (!plateau || !to) {
    return from
  }
  const dx = to.x - from.x
  const dy = to.y - from.y
  const across = plateau.width / 2 + SHORE_OUT
  const down = plateau.height / 2 + SHORE_OUT
  const t = Math.min(across / Math.max(Math.abs(dx), 1e-6), down / Math.max(Math.abs(dy), 1e-6))
  return { x: from.x + dx * t, y: from.y + dy * t }
}

function middleOf(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

function distance(a: Point | undefined, b: Point | undefined): number {
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Number.POSITIVE_INFINITY
}

/** The ties of the units on show, drawn. */
export class GuideTies {
  readonly group = new Group()

  constructor(private readonly pixelRatio: number) {}

  /** Draws these ties, or none. */
  show(ties: readonly [Point, Point][]): void {
    this.clear()
    if (ties.length === 0) {
      return
    }
    const lines = ties.map((tie) => tie.map(({ x, y }) => boardToThree(x, y, WATER_LIFT)))
    const colour = srgb(GUIDE)
    this.group.add(
      createScreenLines(lines, HALO, this.pixelRatio, false),
      createScreenLines(lines, { ...DOTS, colour }, this.pixelRatio, false),
      createScreenDots(lines.flat(), { ...END, fill: colour }, this.pixelRatio),
    )
    // Drawn in this order, over the water.
    this.group.children.forEach((child, at) => {
      child.renderOrder = at
    })
  }

  dispose(): void {
    this.clear()
  }

  private clear(): void {
    for (const child of [...this.group.children] as Mesh[]) {
      this.group.remove(child)
      child.geometry.dispose()
      ;(child.material as ShaderMaterial).dispose()
    }
  }
}
