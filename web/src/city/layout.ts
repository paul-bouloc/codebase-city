import type { Language } from '../ui/Badge'

/** An axis-aligned rectangle on the ground, in board coordinates (x, y), in u. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

/** What a building is made from. */
export interface FileMetrics {
  language: Language
  lines: number
  complexity: number
  test: boolean
}

/** A file's 2 × 2 u lot, by its centre. */
export interface Lot extends Point {
  file: FileMetrics
}

export interface IslandLayout {
  path: string
  /** 1 (foundations, lowest) to 5 (highest). */
  layer: number
  plateau: Rect
  lots: Lot[]
}

export interface CityLayout {
  islands: IslandLayout[]
  /** The union of the plateaux. */
  bounds: Rect
}

export function boundsOf(rects: readonly Rect[]): Rect {
  if (rects.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const rect of rects) {
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** Distance from a point to a rectangle, 0 inside. */
export function distanceToRect(px: number, py: number, rect: Rect): number {
  const dx = Math.max(rect.x - px, 0, px - (rect.x + rect.width))
  const dy = Math.max(rect.y - py, 0, py - (rect.y + rect.height))
  return Math.hypot(dx, dy)
}
