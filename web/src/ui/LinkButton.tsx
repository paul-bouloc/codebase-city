import type { ComponentPropsWithRef, ReactNode } from 'react'
import type { ButtonVariant } from './Button'
import styles from './Button.module.css'
import { Icon } from './Icon'
import type { IconName } from './icons'

type LinkButtonProps = Omit<ComponentPropsWithRef<'a'>, 'children'> & {
  href: string
  variant?: ButtonVariant
  icon?: IconName
  children: ReactNode
}

// A link that looks like a button: it goes somewhere (GitHub) rather than acting on the page.
export function LinkButton({
  variant = 'secondary',
  icon,
  className,
  children,
  ...rest
}: LinkButtonProps) {
  const classes = [styles.button, styles[variant], styles.md, className].filter(Boolean).join(' ')
  return (
    <a className={classes} {...rest}>
      <span className={styles.content}>
        {icon && <Icon name={icon} size={20} />}
        {children}
      </span>
    </a>
  )
}
