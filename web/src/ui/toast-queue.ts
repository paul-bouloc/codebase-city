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
  // Pushed out by a newer toast: it stays in the queue until its exit animation is over.
  leaving?: boolean
}

export const MAX_TOASTS = 3

// Same value as the `duration.toast.dwell` token.
const DWELL_MS = 5000

// How long a toast stays on its own; errors stay until dismissed.
export function toastDwell(tone: ToastTone): number | null {
  return tone === 'error' ? null : DWELL_MS
}

// Newest last. Past the limit, the oldest toast leaves, unless it is an error and another is
// not. Leaving toasts no longer count.
export function pushToast(queue: readonly ToastData[], toast: ToastData): ToastData[] {
  let next = [...queue, toast]
  let shown = next.filter((item) => !item.leaving)
  while (shown.length > MAX_TOASTS) {
    const dropped = shown.find((item) => item.tone !== 'error') ?? shown[0]
    next = next.map((item) => (item === dropped ? { ...item, leaving: true } : item))
    shown = next.filter((item) => !item.leaving)
  }
  return next
}

export function removeToast(queue: readonly ToastData[], id: number): ToastData[] {
  return queue.filter((item) => item.id !== id)
}
