import type { ComponentPropsWithRef, ReactNode } from 'react'
import type { ButtonVariant } from './Button'
import styles from './Button.module.css'
import { Icon } from './Icon'
import type { IconName } from './icons'

const TEXT = {
  newTab: ' (opens in a new tab)',
}

type LinkButtonProps = Omit<ComponentPropsWithRef<'a'>, 'children'> & {
  href: string
  variant?: ButtonVariant
  icon?: IconName
  // Leaves for another site in a new tab, and says so to screen readers.
  newTab?: boolean
  children: ReactNode
}

// A link that looks like a button: it goes somewhere (GitHub) rather than acting on the page.
export function LinkButton({
  variant = 'secondary',
  icon,
  newTab = false,
  className,
  children,
  ...rest
}: LinkButtonProps) {
  const classes = [styles.button, styles[variant], styles.md, className].filter(Boolean).join(' ')
  return (
    <a
      className={classes}
      target={newTab ? '_blank' : undefined}
      rel={newTab ? 'noopener noreferrer' : undefined}
      {...rest}
    >
      <span className={styles.content}>
        {icon && <Icon name={icon} size={20} />}
        {children}
        {newTab && <span className="visually-hidden">{TEXT.newTab}</span>}
      </span>
    </a>
  )
}
