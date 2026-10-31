import { useEffect, useRef } from 'react'

// On opening, moves the focus to the panel's title and remembers where it came from; on closing,
// gives it back there if it was still in the panel (or lost with it).
export function usePanelFocus<P extends HTMLElement, T extends HTMLElement>(open: boolean) {
  const panelRef = useRef<P>(null)
  const titleRef = useRef<T>(null)
  const opener = useRef<HTMLElement | null>(null)

  useEffect(() => {
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
