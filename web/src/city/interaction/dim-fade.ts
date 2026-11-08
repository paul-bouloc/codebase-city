import type { Fading } from '../render/dimming'
import { easeStandard } from '../render/easing'

/** The fading in or out of what is outside the selection, in ms. */
const DIM_DURATION = 280

/** Eases the fading of what is outside the selection toward where it is asked to go. */
export class DimFade {
  private from = 0
  private to = 0
  private since = 0

  constructor(private readonly fading: Fading) {}

  /** Fades toward this value, from where the fading stands now. */
  toward(value: number): void {
    if (value !== this.to) {
      this.from = this.fading.dim.value
      this.to = value
      // Starts at the next frame's time.
      this.since = 0
    }
  }

  /** Moves the fading on; true while it still has a way to go. */
  update(now: number): boolean {
    const { dim } = this.fading
    if (dim.value === this.to) {
      return false
    }
    if (this.since === 0) {
      this.since = now
    }
    const progress = Math.min((now - this.since) / DIM_DURATION, 1)
    dim.value = this.from + (this.to - this.from) * easeStandard(progress)
    if (progress >= 1) {
      dim.value = this.to
    }
    return true
  }
}
