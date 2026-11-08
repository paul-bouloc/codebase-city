import type { CameraAction } from './camera/CameraControls'

// The keys the city screen listens to, wherever the focus is, unless one is typing.

/** A key pressed in a field types; it moves nothing. */
export function isTyping(target: EventTarget | null): boolean {
  return (
    typeof HTMLElement !== 'undefined' &&
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName))
  )
}

const CAMERA_KEYS: Record<string, CameraAction> = {
  '+': 'zoom-in',
  '=': 'zoom-in',
  '-': 'zoom-out',
  '−': 'zoom-out',
  _: 'zoom-out',
  f: 'recenter',
  F: 'recenter',
  t: 'top-view',
  T: 'top-view',
}

/** The camera button a key stands for (`+ − F T`, as their hints say), if any. */
export function cameraKey(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>) {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return null
  }
  return CAMERA_KEYS[event.key] ?? null
}

/** `/` outside a field, or ⌘K (Ctrl+K) anywhere: go to the search field. */
export function isSearchKey(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'target'>,
): boolean {
  if (event.altKey) {
    return false
  }
  if (event.key === 'k' || event.key === 'K') {
    return (event.metaKey || event.ctrlKey) && !event.shiftKey
  }
  return event.key === '/' && !event.metaKey && !event.ctrlKey && !isTyping(event.target)
}
