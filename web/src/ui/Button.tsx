import type { ComponentPropsWithRef, MouseEvent, ReactNode } from 'react'
import styles from './Button.module.css'
import { Icon } from './Icon'
import type { IconName } from './icons'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'github' | 'danger' | 'guide'

// `lg` is for the Build and Progress pages. The admin `sm` size comes with the admin components.
export type ButtonSize = 'md' | 'lg'

type NativeProps = Omit<ComponentPropsWithRef<'button'>, 'children' | 'aria-label'>

// An icon-only button must say what it does.
type ButtonContentProps =
  | { iconOnly?: false; icon?: IconName; label?: never; children: ReactNode }
  | { iconOnly: true; icon: IconName; label: string; children?: never }

interface ButtonOwnProps {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  // The action in progress ("Starting…"). Rendered hidden at all times so the width never jumps.
  // Without it, the spinner sits next to the usual label.
  loadingLabel?: string
  // Blocked for a reason written next to the button (quota, confirmation): stays focusable and
  // readable. Plain `disabled` is for controls that are simply unavailable.
  blocked?: boolean
}

export type ButtonProps = NativeProps & ButtonContentProps & ButtonOwnProps

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  loadingLabel,
  blocked = false,
  iconOnly = false,
  icon,
  label,
  children,
  className,
  type = 'button',
  onClick,
  ...rest
}: ButtonProps) {
  const inert = loading || blocked
  const classes = [
    styles.button,
    styles[variant],
    styles[size],
    iconOnly && styles.iconOnly,
    loading && styles.loading,
    blocked && styles.blocked,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  // An inert button keeps the focus, so it ignores clicks instead of being `disabled`.
  const handleClick = inert
    ? (event: MouseEvent<HTMLButtonElement>) => event.preventDefault()
    : onClick

  return (
    <button
      type={type}
      className={classes}
      aria-label={iconOnly ? label : undefined}
      aria-busy={loading || undefined}
      aria-disabled={inert || undefined}
      onClick={handleClick}
      {...rest}
    >
      <span className={styles.content}>
        {icon && <Icon name={icon} size={20} />}
        {children}
      </span>
      {(loading || loadingLabel) && (
        <span className={styles.progress}>
          <Spinner />
          {!iconOnly && (loadingLabel ?? children)}
        </span>
      )}
    </button>
  )
}
