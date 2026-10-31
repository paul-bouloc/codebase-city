import type { ReactNode } from 'react'

interface LiveRegionProps {
  // What to announce. Rendered or not inside a region that stays mounted.
  children?: ReactNode
  className?: string
}

// Screen readers only announce changes inside a live region that already exists, so a message
// that comes and goes is rendered in here rather than mounted with a role of its own.
export function LiveRegion({ children, className }: LiveRegionProps) {
  return (
    <div aria-live="polite" aria-atomic="true" className={className}>
      {children}
    </div>
  )
}
