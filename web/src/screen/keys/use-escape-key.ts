import { useEffect } from 'react'
import type { CityEngine } from '../../city/engine/city-engine'
import { escapeTarget } from './city-escape'

export interface EscapeState {
  portOpen: boolean
  aboutOpen: boolean
  sheetShown: boolean
  hasSelection: boolean
}

/** Esc that no panel took: closes the open panel first, then clears the selection. */
export function useEscapeKey(
  engine: CityEngine | null,
  { portOpen, aboutOpen, sheetShown, hasSelection }: EscapeState,
  closeAbout: () => void,
  closeSheet: () => void,
  clearSelection: () => void,
): void {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return
      }
      const target = escapeTarget({ panelOpen: portOpen || aboutOpen || sheetShown, hasSelection })
      if (target === 'panel') {
        if (portOpen) {
          engine?.closePort()
        } else if (aboutOpen) {
          closeAbout()
        } else {
          closeSheet()
        }
      } else if (target === 'selection') {
        clearSelection()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [
    engine,
    portOpen,
    aboutOpen,
    sheetShown,
    hasSelection,
    closeAbout,
    closeSheet,
    clearSelection,
  ])
}
