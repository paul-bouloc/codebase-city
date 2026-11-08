import {
  type MouseEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
  useEffect,
  useId,
  useRef,
} from 'react'
import { Button } from '../actions/Button'
import styles from './Dialog.module.css'

const TEXT = {
  close: 'Close',
}

interface DialogProps {
  open: boolean
  // Called for Esc, the scrim and the close button; the page decides whether to close.
  onClose: () => void
  title: string
  children: ReactNode
  // Right-aligned, the main action last.
  actions?: ReactNode
  // Where focus starts: Cancel for a destructive dialog, the field when one must be filled.
  // By default, the first focusable element (the close button).
  initialFocus?: RefObject<HTMLElement | null>
}

// A native modal dialog: the browser makes the rest of the page inert, which traps the focus.
export function Dialog({ open, onClose, title, children, actions, initialFocus }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!open || !dialog) {
      return
    }
    const trigger = document.activeElement
    dialog.showModal()
    initialFocus?.current?.focus()
    return () => {
      dialog.close()
      if (trigger instanceof HTMLElement && trigger.isConnected) {
        trigger.focus()
      }
    }
  }, [open, initialFocus])

  // Esc: the page closes the dialog through `open`, so the browser must not close it alone.
  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault()
    onClose()
  }

  // The dialog box fills the element; a click on the element itself lands on the scrim.
  const handleClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc is the keyboard way to the scrim's click
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={handleCancel}
      onClick={handleClick}
    >
      <div className={styles.box}>
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <Button
            variant="ghost"
            iconOnly
            icon="close"
            label={TEXT.close}
            className={styles.close}
            onClick={onClose}
          />
        </div>
        <div className={styles.body}>{children}</div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </dialog>
  )
}
