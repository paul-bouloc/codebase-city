// When what the pointer rests on stands out, and when its card shows: the building lights up at
// once, so that the pointer shows what it aims at; its card comes at 300 ms and goes 100 ms after
// the pointer leaves. A camera move clears both at once.

export const HOVER_DELAYS = { card: 300, cardLeaves: 100 } as const

export interface HoverListener<T> {
  /** What stands out now, or nothing. */
  highlight(target: T | null): void
  /** What the card shows now, or no card. */
  card(target: T | null): void
}

export class HoverTiming<T> {
  private current: T | null = null
  private carded: T | null = null
  private timers: ReturnType<typeof setTimeout>[] = []

  constructor(
    private readonly listener: HoverListener<T>,
    private readonly same: (a: T, b: T) => boolean,
  ) {}

  /** The pointer now rests on this, or on nothing. */
  point(target: T | null): void {
    const current = this.current
    if (current === target || (current !== null && target !== null && this.same(current, target))) {
      return
    }
    this.cancel()
    this.current = target
    this.listener.highlight(target)
    // Back on what the card still shows, before it left: the card stays.
    const carded = this.carded
    const kept = carded !== null && target !== null && this.same(carded, target)
    if (carded !== null && !kept) {
      this.later(HOVER_DELAYS.cardLeaves, () => this.showCard(null))
    }
    if (target !== null && !kept) {
      this.later(HOVER_DELAYS.card, () => this.showCard(target))
    }
  }

  /** Clears everything at once: the camera moves, or the city goes. */
  clear(): void {
    this.cancel()
    if (this.current !== null) {
      this.listener.highlight(null)
      this.current = null
    }
    this.showCard(null)
  }

  private showCard(target: T | null): void {
    if (this.carded !== target) {
      this.carded = target
      this.listener.card(target)
    }
  }

  private later(delay: number, run: () => void): void {
    this.timers.push(setTimeout(run, delay))
  }

  private cancel(): void {
    for (const timer of this.timers) {
      clearTimeout(timer)
    }
    this.timers = []
  }
}
