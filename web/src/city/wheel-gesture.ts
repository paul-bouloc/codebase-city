/**
 * Browsers send a mouse wheel, two fingers on a trackpad and a trackpad pinch as the same `wheel`
 * event. A pinch is the only one they flag (`ctrlKey`); the other two are told apart by the shape
 * of their deltas.
 */
export type WheelGesture = 'wheel' | 'scroll' | 'pinch'

export interface WheelInput {
  deltaX: number
  deltaY: number
  /** 0 for pixels, 1 for lines, 2 for pages. */
  deltaMode: number
  ctrlKey: boolean
}

/** Events closer than this, in ms, belong to one gesture, and keep its kind. */
const GESTURE_GAP = 200
/** One notch of a mouse wheel in Chrome and Safari on macOS, and its multiples when spun fast. */
const MAC_NOTCH = 4.000244140625
/** A notch elsewhere is 100 or 120 pixels, scaled by the screen's pixel ratio: never below this. */
const MIN_NOTCH = 50

/** Sorts each wheel event into the gesture it comes from. */
export class WheelSorter {
  private kind: 'wheel' | 'scroll' | null = null
  private lastAt = Number.NEGATIVE_INFINITY

  sort(event: WheelInput, time: number): WheelGesture {
    const fresh = time - this.lastAt > GESTURE_GAP
    this.lastAt = time
    if (event.ctrlKey) {
      return 'pinch'
    }
    // A trackpad's flick slows down in steps that can look like a wheel's: the first event of a
    // gesture decides for the rest.
    if (fresh || this.kind === null) {
      this.kind = kindOf(event)
    }
    return this.kind
  }
}

function kindOf({ deltaX, deltaY, deltaMode }: WheelInput): 'wheel' | 'scroll' {
  if (deltaMode !== 0) {
    return 'wheel'
  }
  if (deltaX !== 0) {
    return 'scroll'
  }
  const size = Math.abs(deltaY)
  if (size > 0 && size % MAC_NOTCH === 0) {
    return 'wheel'
  }
  if (Number.isInteger(deltaY) && size >= MIN_NOTCH) {
    return 'wheel'
  }
  return 'scroll'
}
