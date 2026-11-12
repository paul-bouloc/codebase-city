import type { AreaLabel } from '../../city/interaction/city-items'

// Between the city and the labels React draws. The city tells where its labels stand at every
// frame it draws; React would move them a frame later, once the canvas shows, and they would
// trail the city as the camera goes. So React draws a set of labels only when the set changes,
// and the layer moves the labels it drew itself, in the frame the city draws.

/** Draws a set of labels, and fades out those gone from it. */
type Draw = (labels: readonly AreaLabel[], gone: readonly AreaLabel[]) => void

/** Any element the layer moves: a label React drew. */
interface Movable {
  style: { transform: string }
}

/**
 * Where a label stands on the page, to the fraction of a pixel: whole pixels would make it step
 * while the city glides.
 */
export function placeAt(x: number, y: number): string {
  return `translate3d(${x}px, ${y}px, 0)`
}

export class AreaLabelLayer {
  private latest: readonly AreaLabel[] = []
  private drawnKey = ''
  private readonly elements = new Map<string, Movable>()
  private draw: Draw | null = null

  /**
   * Hears where the city stands its labels: moves those drawn, or has a new set drawn, with the
   * labels gone from it where they last stood.
   */
  readonly update = (labels: readonly AreaLabel[]): void => {
    const before = this.latest
    this.latest = labels
    const key = keyOf(labels)
    if (key !== this.drawnKey && this.draw) {
      this.drawnKey = key
      const kept = new Set(labels.map((label) => label.path))
      this.draw(
        labels,
        before.filter((label) => !kept.has(label.path)),
      )
      return
    }
    this.position()
  }

  /** Who draws a new set of labels, from now on; the set at hand at once. */
  connect(draw: Draw): () => void {
    this.draw = draw
    this.drawnKey = keyOf(this.latest)
    draw(this.latest, [])
    return () => {
      this.draw = null
    }
  }

  /** The element of a label drawn, or null once it is gone. */
  element(path: string, element: Movable | null): void {
    if (element) {
      this.elements.set(path, element)
    } else {
      this.elements.delete(path)
    }
  }

  /** Stands each label drawn where the city last said. */
  position(): void {
    for (const label of this.latest) {
      const element = this.elements.get(label.path)
      if (element) {
        element.style.transform = placeAt(label.x, label.y)
      }
    }
  }
}

/** What React draws of a set of labels: all but where they stand. */
function keyOf(labels: readonly AreaLabel[]): string {
  return labels
    .map((label) => [label.path, label.name, label.caption ?? '', label.lean].join('\u0000'))
    .join('\u0001')
}
