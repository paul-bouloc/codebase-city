import { type FocusEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { rovingIndex } from '../actions/roving-index'
import { Icon } from '../Icon'
import styles from './AccountMenu.module.css'
import { Avatar } from './Avatar'

const TEXT = {
  trigger: (login: string) => `Account menu for ${login}`,
  menu: 'Account',
  account: 'My account',
  signOut: 'Sign out',
}

const ITEM_COUNT = 2
const NONE_DISABLED = Array<boolean>(ITEM_COUNT).fill(false)

interface AccountMenuProps {
  login: string
  avatarSrc?: string
  // "7 of 10 analyses left today · resets at 1:00 AM". Absent for a blocked account.
  quota?: string
  accountHref: string
  onSignOut: () => void
}

export function AccountMenu({ login, avatarSrc, quota, accountHref, onSignOut }: AccountMenuProps) {
  // The item to focus while open, or null when closed.
  const [focused, setFocused] = useState<number | null>(null)
  const open = focused !== null
  // Closed but still fading out: drawn, without the menu semantics on the trigger.
  const [closing, setClosing] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLElement | null)[]>([])
  const menuId = useId()

  useEffect(() => {
    if (focused !== null) {
      itemRefs.current[focused]?.focus()
    }
  }, [focused])

  const close = (returnFocus: boolean) => {
    setFocused(null)
    setClosing(true)
    if (returnFocus) {
      triggerRef.current?.focus()
    }
  }

  const handleTriggerKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setFocused(event.key === 'ArrowDown' ? 0 : ITEM_COUNT - 1)
    }
  }

  // On the whole widget, so Esc works wherever the focus is while open.
  const handleEscape = (event: KeyboardEvent<HTMLDivElement>) => {
    if (open && event.key === 'Escape') {
      event.preventDefault()
      close(true)
    }
  }

  const handleMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = rovingIndex(event.key, focused ?? 0, NONE_DISABLED, 'vertical')
    if (next !== null) {
      event.preventDefault()
      setFocused(next)
    }
  }

  // Tab, or a click anywhere else, takes the focus out: the menu closes.
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (open && !event.currentTarget.contains(event.relatedTarget)) {
      close(false)
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Esc and the focus leaving close the menu
    <div className={styles.wrapper} onBlur={handleBlur} onKeyDown={handleEscape}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={TEXT.trigger(login)}
        onClick={() => (open ? close(false) : setFocused(0))}
        onKeyDown={handleTriggerKey}
      >
        <Avatar login={login} src={avatarSrc} size={32} />
        <Icon name="chevron-down" size={16} className={styles.chevron} />
      </button>

      {(open || closing) && (
        // Focusable, so a click on the header keeps the focus inside and the menu open.
        <div
          className={open ? styles.popup : `${styles.popup} ${styles.closing}`}
          tabIndex={-1}
          inert={!open}
          onAnimationEnd={(event) => {
            if (!open && event.target === event.currentTarget) {
              setClosing(false)
            }
          }}
        >
          <div className={styles.header}>
            <Avatar login={login} src={avatarSrc} size={40} />
            <span className={styles.who}>
              <span className={styles.login}>{login}</span>
              {quota && <span className={styles.quota}>{quota}</span>}
            </span>
          </div>
          <div
            id={menuId}
            role="menu"
            aria-label={TEXT.menu}
            className={styles.menu}
            onKeyDown={handleMenuKey}
          >
            <a
              ref={(element) => {
                itemRefs.current[0] = element
              }}
              role="menuitem"
              tabIndex={-1}
              href={accountHref}
              className={styles.item}
            >
              <Icon name="user" size={18} />
              {TEXT.account}
            </a>
            <button
              ref={(element) => {
                itemRefs.current[1] = element
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={styles.item}
              onClick={() => {
                close(true)
                onSignOut()
              }}
            >
              <Icon name="sign-out" size={18} />
              {TEXT.signOut}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
