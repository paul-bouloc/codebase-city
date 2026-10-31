import { useLayoutEffect, useRef, useState } from 'react'
import { truncatePath } from './truncate-path'

let canvas: HTMLCanvasElement | undefined

type FontStyle = Pick<CSSStyleDeclaration, 'fontStyle' | 'fontWeight' | 'fontSize' | 'fontFamily'>

// Built from the longhands: some browsers serialize the computed `font` shorthand as an empty
// string, which would leave the canvas on its 10 px default.
export function canvasFont(style: FontStyle): string {
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
}

// Takes the exact width: a rounded-up one could let one character too many through, and the
// CSS ellipsis would then cut the file name. The tolerance keeps an exact fit (302.4 / 7.2 is
// 41.999… in floating point).
export function maxCharsFor(width: number, charWidth: number): number {
  return charWidth > 0 ? Math.floor(width / charWidth + 1e-6) : Number.POSITIVE_INFINITY
}

// Paths are set in a monospace font, so one character's width gives the budget.
function charWidth(element: HTMLElement): number {
  canvas ??= document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) {
    return 0
  }
  context.font = canvasFont(getComputedStyle(element))
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
      setMaxChars(maxCharsFor(element.getBoundingClientRect().width, charWidth(element)))
    }
    const observer = new ResizeObserver(fit)
    observer.observe(element)
    // The web font changes the character width without resizing anything.
    document.fonts.ready.then(fit)
    return () => observer.disconnect()
  }, [])

  return { ref, text: truncatePath(path, maxChars) }
}
