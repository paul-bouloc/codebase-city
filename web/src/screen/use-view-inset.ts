import { type RefObject, useEffect } from 'react'
import type { CityEngine } from '../city/engine/city-engine'

/** Room kept clear left of the open sheet, in px: as the camera controls keep (444 px). */
const SHEET_GAP = 12

/**
 * The open sheet covers the right of the city: flights frame left of it, and a selection it
 * hides slides clear. It covers its travel and the margin left of it.
 */
export function useViewInset(
  engine: CityEngine | null,
  screen: RefObject<HTMLElement | null>,
  sheetShown: boolean,
): void {
  useEffect(() => {
    const element = screen.current
    if (!engine || !element) {
      return
    }
    const travel = Number.parseFloat(getComputedStyle(element).getPropertyValue('--sheet-travel'))
    engine.setViewInset(sheetShown && Number.isFinite(travel) ? travel + SHEET_GAP : 0)
  }, [engine, screen, sheetShown])
}
