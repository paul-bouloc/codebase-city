import { useLayoutEffect, useRef, useState } from 'react'
import { truncatePath } from './truncate-path'

let canvas: HTMLCanvasElement | undefined
const widths = new Map<string, number>()

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

// Paths are set in a monospace font, so one character's width gives the budget. Widths are kept
// once the web fonts are in: before that, the fallback font is being measured.
function charWidth(element: HTMLElement): number {
  const font = canvasFont(getComputedStyle(element))
  const known = widths.get(font)
  if (known !== undefined) {
    return known
  }
  canvas ??= document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) {
    return 0
  }
  context.font = font
  const width = context.measureText('0').width
  if (document.fonts.status === 'loaded') {
    widths.set(font, width)
  }
  return width
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
    // The style is read once, not on every resize of a long list.
    let width = charWidth(element)
    const refit = () => {
      setMaxChars(maxCharsFor(element.getBoundingClientRect().width, width))
    }
    const observer = new ResizeObserver(refit)
    observer.observe(element)
    // The web font changes the character width without resizing anything.
    document.fonts.ready.then(() => {
      width = charWidth(element)
      refit()
    })
    return () => observer.disconnect()
  }, [])

  return { ref, text: truncatePath(path, maxChars) }
}
