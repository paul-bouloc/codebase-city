import { useCallback, useEffect } from 'react'
import type { CityEngine } from '../../city/engine/city-engine'
import { cameraKey, isTyping } from '../screen-keys'
import type { CameraAction } from './CameraControls'

/** What the camera buttons do, also on + − F T, as their hints say. */
export function useCameraActions(engine: CityEngine | null): (action: CameraAction) => void {
  const cameraAction = useCallback(
    (action: CameraAction) => {
      switch (action) {
        case 'north':
          engine?.faceNorth()
          break
        case 'zoom-in':
          engine?.zoom(1)
          break
        case 'zoom-out':
          engine?.zoom(-1)
          break
        case 'recenter':
          engine?.recenter()
          break
        case 'top-view':
          engine?.toggleTopView()
          break
      }
    },
    [engine],
  )

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const action = cameraKey(event)
      if (!action || event.defaultPrevented || isTyping(event.target)) {
        return
      }
      event.preventDefault()
      cameraAction(action)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [cameraAction])

  return cameraAction
}
