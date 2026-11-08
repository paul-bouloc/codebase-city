import { useEffect } from 'react'
import type { CityEngine } from '../city/engine/city-engine'
import { driveOf, isDriveKey, STILL } from '../city/engine/drive'
import { isTyping } from './screen-keys'

/** W A S D move the camera along the ground and Q E turn it, while held. */
export function useDriveKeys(engine: CityEngine | null): void {
  useEffect(() => {
    if (!engine) {
      return
    }
    const held = new Set<string>()
    const update = () => engine.setDrive(driveOf(held))
    const down = (event: KeyboardEvent) => {
      if (
        isTyping(event.target) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        !isDriveKey(event.code)
      ) {
        return
      }
      event.preventDefault()
      held.add(event.code)
      update()
    }
    const up = (event: KeyboardEvent) => {
      if (held.delete(event.code)) {
        update()
      }
    }
    // A key released in another window never comes up here.
    const release = () => {
      held.clear()
      update()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', release)
      engine.setDrive(STILL)
    }
  }, [engine])
}
