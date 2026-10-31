import styles from './Icon.module.css'
import { GITHUB_MARK_PATH, ICON_PATHS, type IconName } from './icon-paths'

export type IconSize = 16 | 20 | 24

interface IconBaseProps {
  name: IconName
  size?: IconSize
  className?: string
}

// Decorative by default. An icon that carries meaning on its own (alone in a button,
// for instance) is `standalone` and must say what it means.
type IconLabelProps = { standalone?: false; label?: never } | { standalone: true; label: string }

export type IconProps = IconBaseProps & IconLabelProps

// The stroke stays 2 units on the 24 grid: 2, 1.67 and 1.33 px once scaled.
const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

// GitHub's mark is a filled shape.
const FILL = { fill: 'currentColor' } as const

export function Icon({ name, size = 24, className, standalone, label }: IconProps) {
  const isGithub = name === 'github'
  return (
    <svg
      className={className ? `${styles.icon} ${className}` : styles.icon}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={standalone ? 'img' : undefined}
      aria-label={standalone ? label : undefined}
      aria-hidden={standalone ? undefined : true}
      {...(isGithub ? FILL : STROKE)}
    >
      <path d={isGithub ? GITHUB_MARK_PATH : ICON_PATHS[name]} />
    </svg>
  )
}
