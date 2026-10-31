import type { ComponentPropsWithRef } from 'react'
import styles from './Glass.module.css'

type GlassElement = 'div' | 'section' | 'header'

type GlassProps = ComponentPropsWithRef<'div'> & {
  as?: GlassElement
  // `lg` for panels, `md` for small cards and pills.
  radius?: 'md' | 'lg'
}

// The one recipe for everything that floats over the city: near opaque, the blur only wipes out
// the texture behind. Without backdrop-filter, or with reduced transparency, it turns opaque
// (tokens.css). The radius is a prop: a class would race the recipe's in the CSS order.
export function Glass({ as: Element = 'div', radius = 'lg', className, ...rest }: GlassProps) {
  const classes = [styles.glass, radius === 'md' && styles.md, className].filter(Boolean).join(' ')
  return <Element className={classes} {...rest} />
}
