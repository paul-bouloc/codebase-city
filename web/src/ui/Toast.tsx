import {
  type AnimationEvent,
  type FocusEvent,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'
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
  // Closed by hand or at the end of its dwell time: the exit starts.
  onLeave: () => void
  // The exit animation is over: the toast can leave the queue.
  onLeft: () => void
}

export function Toast({ toast, onLeave, onLeft }: ToastProps) {
  const [paused, setPaused] = useState(false)
  // Marked in the queue, so a newer toast does not count this one while it fades out.
  const leaving = toast.leaving !== undefined
  const remaining = useRef(toastDwell(toast.tone))
  // The timer below calls the latest callback without restarting.
  const leaveAfterDwell = useEffectEvent(onLeave)

  // The dwell time runs only while the toast is neither hovered nor focused, and resumes where
  // it stopped.
  useEffect(() => {
    const left = remaining.current
    if (paused || left === null) {
      return
    }
    const start = Date.now()
    const timer = setTimeout(leaveAfterDwell, left)
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
      onLeft()
    }
  }

  const slotClasses = [
    styles.slot,
    leaving && styles.leaving,
    toast.leaving === 'pushed' && styles.pushed,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    // The slot folds its height away on exit, so the other toasts slide instead of jumping.
    // Inert meanwhile: a second Enter on the action must not run it again.
    <div className={slotClasses} inert={leaving} onAnimationEnd={handleExitEnd}>
      <div className={styles.fold}>
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
                onLeave()
              }}
            >
              {toast.action.label}
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            className={styles.dismiss}
            aria-label={TEXT.dismiss}
            onClick={onLeave}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
