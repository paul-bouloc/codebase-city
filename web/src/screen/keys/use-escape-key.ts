import { useEffect } from 'react'
import type { CityEngine } from '../../city/engine/city-engine'
import { escapeTarget } from './city-escape'

export interface EscapeState {
  portOpen: boolean
  aboutOpen: boolean
  sheetShown: boolean
  hasSelection: boolean
  guideOpen: boolean
  answerOpen: boolean
}

/**
 * Esc that no panel took: closes the open panel first, then leaves an answer for the questions,
 * then clears the selection, then folds the guide.
 */
export function useEscapeKey(
  engine: CityEngine | null,
  { portOpen, aboutOpen, sheetShown, hasSelection, guideOpen, answerOpen }: EscapeState,
  closeAbout: () => void,
  closeSheet: () => void,
  clearSelection: () => void,
  foldGuide: () => void,
  leaveAnswer: () => void,
): void {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return
      }
      const target = escapeTarget({
        panelOpen: portOpen || aboutOpen || sheetShown,
        hasSelection,
        guideOpen,
        answerOpen,
      })
      if (target === 'panel') {
        if (portOpen) {
          engine?.closePort()
        } else if (aboutOpen) {
          closeAbout()
        } else {
          closeSheet()
        }
      } else if (target === 'answer') {
        leaveAnswer()
      } else if (target === 'selection') {
        clearSelection()
      } else if (target === 'guide') {
        foldGuide()
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
    guideOpen,
    answerOpen,
    closeAbout,
    closeSheet,
    clearSelection,
    foldGuide,
    leaveAnswer,
  ])
}
