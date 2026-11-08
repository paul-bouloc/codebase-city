import type { CameraAction } from './CameraControls'

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
