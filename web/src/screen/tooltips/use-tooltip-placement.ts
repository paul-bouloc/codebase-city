import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react'
import { type Point, placeTooltip, type Rect } from './tooltip-placement'

// Places a fixed tooltip beside the pointer once its size is known; it stays hidden until then.
// `obstacles` (the open panels) must keep its identity between renders.
export function useTooltipPlacement<T extends HTMLElement>(
  pointer: Point,
  obstacles: readonly Rect[] | undefined,
) {
  const ref = useRef<T>(null)
  const [position, setPosition] = useState<Point | null>(null)
  const { x, y } = pointer

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }
    const size = { width: element.offsetWidth, height: element.offsetHeight }
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    setPosition(placeTooltip({ x, y }, size, viewport, obstacles))
  }, [x, y, obstacles])

  const style: CSSProperties = position
    ? { left: position.x, top: position.y }
    : { left: 0, top: 0, visibility: 'hidden' }
  return { ref, style }
}
