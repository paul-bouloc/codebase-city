import type { ComponentPropsWithRef, ReactNode } from 'react'

const TEXT = {
  newTab: ' (opens in a new tab)',
}

type ExternalLinkProps = Omit<ComponentPropsWithRef<'a'>, 'target' | 'rel'> & {
  href: string
  children: ReactNode
}

// A link that leaves the city for another site, in a new tab so the city stays where it was.
// Screen readers hear that it opens a new tab.
export function ExternalLink({ children, ...rest }: ExternalLinkProps) {
  return (
    <a target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
      <span className="visually-hidden">{TEXT.newTab}</span>
    </a>
  )
}
