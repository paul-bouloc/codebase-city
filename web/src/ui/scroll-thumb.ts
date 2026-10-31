// Below this, a thumb is hard to catch.
export const MIN_THUMB = 24

export interface ThumbGeometry {
  // Null when the content fits: no bar at all.
  size: number
  offset: number
}

// Size and position of a scrollbar thumb along a track, from the scroll metrics of one axis.
export function thumbGeometry(
  viewport: number,
  content: number,
  scroll: number,
  track: number,
): ThumbGeometry | null {
  if (content <= viewport + 1 || track <= 0) {
    return null
  }
  const size = Math.max(MIN_THUMB, Math.min(track, (viewport / content) * track))
  const maxScroll = content - viewport
  const ratio = Math.max(0, Math.min(1, scroll / maxScroll))
  return { size, offset: ratio * (track - size) }
}

// How far to scroll for a thumb dragged by `delta` pixels along its track.
export function scrollForThumbDelta(
  delta: number,
  viewport: number,
  content: number,
  track: number,
  thumb: number,
): number {
  const room = track - thumb
  return room > 0 ? (delta / room) * (content - viewport) : 0
}
