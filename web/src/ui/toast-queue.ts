export type ToastTone = 'success' | 'error' | 'info'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastData {
  id: number
  tone: ToastTone
  title: string
  body?: string
  action?: ToastAction
}

export const MAX_TOASTS = 3

// Same value as the `duration.toast.dwell` token.
const DWELL_MS = 5000

// How long a toast stays on its own; errors stay until dismissed.
export function toastDwell(tone: ToastTone): number | null {
  return tone === 'error' ? null : DWELL_MS
}

// Newest last. Past the limit, the oldest toast goes, unless it is an error and another is not.
export function pushToast(queue: readonly ToastData[], toast: ToastData): ToastData[] {
  const next = [...queue, toast]
  while (next.length > MAX_TOASTS) {
    const dropped = next.findIndex((item) => item.tone !== 'error')
    next.splice(dropped === -1 ? 0 : dropped, 1)
  }
  return next
}

export function removeToast(queue: readonly ToastData[], id: number): ToastData[] {
  return queue.filter((item) => item.id !== id)
}
