import { useEffect, useRef } from 'react'

// When the panel opens, moves the focus to its title and remembers where it came from; when it
// closes, gives it back there if it was still in the panel (or lost with it). Only the change
// counts: a panel mounted open (a demonstration board) leaves the focus alone.
export function usePanelFocus<P extends HTMLElement, T extends HTMLElement>(open: boolean) {
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
      titleRef.current?.focus()
      return
    }
    const active = document.activeElement
    const lost = active === null || active === document.body
    if (opener.current && (lost || panelRef.current?.contains(active))) {
      opener.current.focus()
    }
    opener.current = null
  }, [open])

  return { panelRef, titleRef }
}
