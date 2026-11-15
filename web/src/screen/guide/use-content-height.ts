import { useLayoutEffect, useRef, useState } from 'react'

/**
 * The height of what a box holds, its borders added, followed as it changes: the box takes it,
 * and a CSS transition on its height eases it from one size to the next. Undefined until
 * measured.
 */
export function useContentHeight<B extends HTMLElement, C extends HTMLElement>() {
  const boxRef = useRef<B>(null)
  const contentRef = useRef<C>(null)
  const [height, setHeight] = useState<number | undefined>(undefined)
  useLayoutEffect(() => {
    const box = boxRef.current
    const content = contentRef.current
    if (!box || !content) {
      return
    }
    // The box's borders, which a border-box height counts: it scrolls nothing
    const measure = () => setHeight(content.offsetHeight + box.offsetHeight - box.clientHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [])
  return { boxRef, contentRef, height }
}
