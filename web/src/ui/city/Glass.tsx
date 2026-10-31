import type { ComponentPropsWithRef } from 'react'
import styles from './Glass.module.css'

type GlassElement = 'div' | 'section' | 'header'

type GlassProps = ComponentPropsWithRef<'div'> & {
  as?: GlassElement
}

// The one recipe for everything that floats over the city: near opaque, the blur only wipes out
// the texture behind. Without backdrop-filter, or with reduced transparency, it turns opaque
// (tokens.css). Radius `lg` by default; a component sets its own through `className`.
export function Glass({ as: Element = 'div', className, ...rest }: GlassProps) {
  const classes = className ? `${styles.glass} ${className}` : styles.glass
  return <Element className={classes} {...rest} />
}
