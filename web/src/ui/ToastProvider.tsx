import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react'
import { Toast } from './Toast'
import styles from './ToastProvider.module.css'
import { ToastContext, type ToastInput } from './toast-context'
import { pushToast, removeToast, type ToastData } from './toast-queue'

const TEXT = {
  region: 'Notifications',
}

// Holds the toasts of the whole app and draws them bottom-left.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<ToastData[]>([])
  const nextId = useRef(0)

  const show = useCallback((toast: ToastInput) => {
    nextId.current += 1
    const id = nextId.current
    setQueue((current) => pushToast(current, { ...toast, id }))
  }, [])

  const api = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Always mounted, so the first toast is announced too. Errors are polite as well: a
          politeness that changes with the content gets lost. */}
      <section className={styles.host} aria-label={TEXT.region} aria-live="polite">
        {queue.map((toast) => (
          <Toast
            key={toast.id}
            toast={toast}
            onDismiss={() => setQueue((current) => removeToast(current, toast.id))}
          />
        ))}
      </section>
    </ToastContext.Provider>
  )
}
