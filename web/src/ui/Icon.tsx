import styles from './Icon.module.css'
import { GITHUB_MARK_PATH, type IconName, LUCIDE_ICONS } from './icons'

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

export function Icon({ name, size = 24, className, standalone, label }: IconProps) {
  const classes = className ? `${styles.icon} ${className}` : styles.icon
  const a11y = {
    role: standalone ? 'img' : undefined,
    'aria-label': standalone ? label : undefined,
    'aria-hidden': standalone ? undefined : true,
  }

  if (name === 'github') {
    return (
      <svg
        className={classes}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        role={a11y.role}
        aria-label={a11y['aria-label']}
        aria-hidden={a11y['aria-hidden']}
      >
        <path d={GITHUB_MARK_PATH} />
      </svg>
    )
  }

  // The stroke stays 2 units on the 24 grid: 2, 1.67 and 1.33 px once scaled.
  const LucideIcon = LUCIDE_ICONS[name]
  return <LucideIcon className={classes} size={size} strokeWidth={2} {...a11y} />
}
