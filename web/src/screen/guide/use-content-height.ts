import { useLayoutEffect, useRef, useState } from 'react'

/**
 * The height of what a box holds, followed as it changes: the box takes it, and a CSS transition
 * on its height eases it from one size to the next. Undefined until measured.
 */
export function useContentHeight<T extends HTMLElement>() {
  const contentRef = useRef<T>(null)
  const [height, setHeight] = useState<number | undefined>(undefined)
  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) {
      return
    }
    setHeight(content.offsetHeight)
    const observer = new ResizeObserver(() => setHeight(content.offsetHeight))
    observer.observe(content)
    return () => observer.disconnect()
  }, [])
  return { contentRef, height }
}
