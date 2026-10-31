import { type AnimationEvent, type FocusEvent, useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import type { IconName } from './icons'
import styles from './Toast.module.css'
import { type ToastData, type ToastTone, toastDwell } from './toast-queue'

const TEXT = {
  dismiss: 'Dismiss',
}

const ICONS: Record<ToastTone, IconName> = {
  success: 'check',
  error: 'error',
  info: 'info',
}

interface ToastProps {
  toast: ToastData
  onDismiss: () => void
}

export function Toast({ toast, onDismiss }: ToastProps) {
  const [paused, setPaused] = useState(false)
  // Fading out: the toast leaves the queue once its exit animation is over.
  const [leaving, setLeaving] = useState(false)
  const remaining = useRef(toastDwell(toast.tone))
  const leave = () => setLeaving(true)

  // The dwell time runs only while the toast is neither hovered nor focused, and resumes where
  // it stopped.
  useEffect(() => {
    const left = remaining.current
    if (paused || left === null) {
      return
    }
    const start = Date.now()
    const timer = setTimeout(() => setLeaving(true), left)
    return () => {
      clearTimeout(timer)
      remaining.current = left - (Date.now() - start)
    }
  }, [paused])

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setPaused(false)
    }
  }

  // The slot's own exit, not the toast's entry bubbling up.
  const handleExitEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (leaving && event.target === event.currentTarget) {
      onDismiss()
    }
  }

  return (
    // The slot folds its height away on exit, so the other toasts slide instead of jumping.
    <div
      className={leaving ? `${styles.slot} ${styles.leaving}` : styles.slot}
      onAnimationEnd={handleExitEnd}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover and focus only pause the timer */}
      <div
        className={`${styles.toast} ${styles[toast.tone]}`}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={handleBlur}
      >
        <Icon name={ICONS[toast.tone]} size={20} className={styles.icon} />
        <div className={styles.text}>
          <span className={styles.title}>{toast.title}</span>
          {toast.body && <span className={styles.body}>{toast.body}</span>}
        </div>
        {toast.action ? (
          <button
            type="button"
            className={styles.action}
            onClick={() => {
              toast.action?.onClick()
              leave()
            }}
          >
            {toast.action.label}
          </button>
        ) : (
          <span />
        )}
        <button type="button" className={styles.dismiss} aria-label={TEXT.dismiss} onClick={leave}>
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  )
}
