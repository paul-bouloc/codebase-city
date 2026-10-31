import { useLayoutEffect, useRef, useState } from 'react'
import { truncatePath } from './truncate-path'

let canvas: HTMLCanvasElement | undefined

// Paths are set in a monospace font, so one character's width gives the budget.
function charWidth(element: HTMLElement): number {
  canvas ??= document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) {
    return 0
  }
  context.font = getComputedStyle(element).font
  return context.measureText('0').width
}

// Fits `path` into the width of the returned element, which must not grow with its text
// (a block, or a grid or flex item with `min-width: 0`).
export function useTruncatedPath<T extends HTMLElement>(path: string) {
  const ref = useRef<T>(null)
  const [maxChars, setMaxChars] = useState(Number.POSITIVE_INFINITY)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }
    const fit = () => {
      const width = charWidth(element)
      setMaxChars(width > 0 ? Math.floor(element.clientWidth / width) : Number.POSITIVE_INFINITY)
    }
    const observer = new ResizeObserver(fit)
    observer.observe(element)
    // The web font changes the character width without resizing anything.
    document.fonts.ready.then(fit)
    return () => observer.disconnect()
  }, [])

  return { ref, text: truncatePath(path, maxChars) }
}
