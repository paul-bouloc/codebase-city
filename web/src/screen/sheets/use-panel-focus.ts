import { useEffect, useRef } from 'react'

// When the panel opens, moves the focus to its title and remembers where it came from; when it
// closes, gives it back there if it was still in the panel (or lost with it). Only the change
// counts: a panel mounted open (a demonstration board) leaves the focus alone. When its content
// changes while open (`contentKey`: another file), a focus lost with the old content goes to
// the title; the opener stays the one to return to.
// The title takes the focus without scrolling: a sheet is still sliding in, off screen.
export function usePanelFocus<P extends HTMLElement, T extends HTMLElement>(
  open: boolean,
  contentKey?: string,
) {
  const panelRef = useRef<P>(null)
  const titleRef = useRef<T>(null)
  const opener = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(open)

  useEffect(() => {
    if (open === wasOpen.current) {
      return
    }
    wasOpen.current = open
    if (open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      titleRef.current?.focus({ preventScroll: true })
      return
    }
    const active = document.activeElement
    const lost = active === null || active === document.body
    if (opener.current && (lost || panelRef.current?.contains(active))) {
      opener.current.focus()
    }
    opener.current = null
  }, [open])

  const shownKey = useRef(contentKey)
  useEffect(() => {
    if (contentKey === shownKey.current) {
      return
    }
    shownKey.current = contentKey
    const active = document.activeElement
    if (open && (active === null || active === document.body)) {
      titleRef.current?.focus({ preventScroll: true })
    }
  }, [open, contentKey])

  return { panelRef, titleRef }
}
