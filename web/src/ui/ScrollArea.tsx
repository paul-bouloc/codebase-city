import {
  type ComponentPropsWithRef,
  type CSSProperties,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import styles from './ScrollArea.module.css'
import { scrollForThumbDelta, type ThumbGeometry, thumbGeometry } from './scroll-thumb'

// How long the bars stay after the last scroll.
const LINGER_MS = 900

type Axis = 'vertical' | 'horizontal'

type ScrollAreaProps = Omit<ComponentPropsWithRef<'div'>, 'className'> & {
  // On the outer box, which clips: size, radius, background.
  className?: string
  // On the box that scrolls: padding, layout of the content.
  viewportClassName?: string
  // What the scrolling box is, when it is a landmark or takes the focus.
  as?: 'div' | 'section'
}

// Native scrolling (wheel, keys, touch, scroll anchoring) under slim overlay bars drawn from the
// tokens: the browser's own bars are hidden. The bars show on hover and while scrolling.
export function ScrollArea({
  className,
  viewportClassName,
  as: Viewport = 'div',
  children,
  ref,
  ...viewportProps
}: ScrollAreaProps) {
  const viewportRef = useRef<HTMLElement | null>(null)
  const verticalTrack = useRef<HTMLDivElement>(null)
  const horizontalTrack = useRef<HTMLDivElement>(null)
  const [thumbs, setThumbs] = useState<Record<Axis, ThumbGeometry | null>>({
    vertical: null,
    horizontal: null,
  })
  const [scrolling, setScrolling] = useState(false)
  const linger = useRef<ReturnType<typeof setTimeout>>(undefined)

  const measure = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    setThumbs({
      vertical: thumbGeometry(
        viewport.clientHeight,
        viewport.scrollHeight,
        viewport.scrollTop,
        verticalTrack.current?.clientHeight ?? 0,
      ),
      horizontal: thumbGeometry(
        viewport.clientWidth,
        viewport.scrollWidth,
        viewport.scrollLeft,
        horizontalTrack.current?.clientWidth ?? 0,
      ),
    })
  }, [])

  // The content changes size as lists unfold or tabs switch: watch the box and its children.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    const resize = new ResizeObserver(measure)
    const observeChildren = () => {
      resize.disconnect()
      resize.observe(viewport)
      for (const child of viewport.children) {
        resize.observe(child)
      }
      measure()
    }
    const mutations = new MutationObserver(observeChildren)
    mutations.observe(viewport, { childList: true })
    observeChildren()
    return () => {
      resize.disconnect()
      mutations.disconnect()
      clearTimeout(linger.current)
    }
  }, [measure])

  const handleScroll = () => {
    measure()
    setScrolling(true)
    clearTimeout(linger.current)
    linger.current = setTimeout(() => setScrolling(false), LINGER_MS)
  }

  // Drag the thumb; a press on the track pages towards the pointer.
  const startDrag = (axis: Axis) => (event: PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current
    const track = (axis === 'vertical' ? verticalTrack : horizontalTrack).current
    const thumb = thumbs[axis]
    if (!viewport || !track || !thumb || event.button !== 0) {
      return
    }
    event.preventDefault()
    const vertical = axis === 'vertical'
    const pointer = vertical ? event.clientY : event.clientX
    const trackStart = vertical
      ? track.getBoundingClientRect().top
      : track.getBoundingClientRect().left
    const onThumb =
      pointer >= trackStart + thumb.offset && pointer <= trackStart + thumb.offset + thumb.size
    if (!onThumb) {
      const page = vertical ? viewport.clientHeight : viewport.clientWidth
      const forward = pointer > trackStart + thumb.offset
      viewport.scrollBy({
        [vertical ? 'top' : 'left']: forward ? page : -page,
        behavior: 'smooth',
      })
      return
    }
    const startScroll = vertical ? viewport.scrollTop : viewport.scrollLeft
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const move = (moveEvent: globalThis.PointerEvent) => {
      const delta = (vertical ? moveEvent.clientY : moveEvent.clientX) - pointer
      const scroll =
        startScroll +
        scrollForThumbDelta(
          delta,
          vertical ? viewport.clientHeight : viewport.clientWidth,
          vertical ? viewport.scrollHeight : viewport.scrollWidth,
          vertical ? track.clientHeight : track.clientWidth,
          thumb.size,
        )
      if (vertical) {
        viewport.scrollTop = scroll
      } else {
        viewport.scrollLeft = scroll
      }
    }
    const end = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', end)
      target.removeEventListener('pointercancel', end)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', end)
    target.addEventListener('pointercancel', end)
  }

  const bar = (axis: Axis) => {
    const thumb = thumbs[axis]
    const place = thumb
      ? ({
          '--thumb-size': `${thumb.size}px`,
          '--thumb-offset': `${thumb.offset}px`,
        } as CSSProperties)
      : undefined
    return (
      <div
        ref={axis === 'vertical' ? verticalTrack : horizontalTrack}
        className={`${styles.track} ${styles[axis]}`}
        data-active={thumb ? true : undefined}
        aria-hidden="true"
        onPointerDown={startDrag(axis)}
      >
        {thumb && <div className={styles.thumb} style={place} />}
      </div>
    )
  }

  const rootClasses = [styles.root, scrolling && styles.scrolling, className]
    .filter(Boolean)
    .join(' ')
  const viewportClasses = viewportClassName
    ? `${styles.viewport} ${viewportClassName}`
    : styles.viewport

  return (
    <div className={rootClasses}>
      <Viewport
        ref={(element: HTMLElement | null) => {
          viewportRef.current = element
          if (typeof ref === 'function') {
            ref(element as HTMLDivElement | null)
          } else if (ref) {
            ref.current = element as HTMLDivElement | null
          }
        }}
        className={viewportClasses}
        onScroll={handleScroll}
        {...viewportProps}
      >
        {children}
      </Viewport>
      {bar('vertical')}
      {bar('horizontal')}
    </div>
  )
}
