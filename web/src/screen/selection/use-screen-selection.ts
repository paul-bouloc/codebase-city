import { useCallback, useRef, useState } from 'react'
import type { CityEngine } from '../../city/engine/city-engine'
import type { CityItem } from '../../city/interaction/city-items'
import type { ResultIndex } from '../result-index'
import type { ScreenSelection } from './selection-hash'

/** A line of a file to open its code at; each request opens it again. */
export interface OpenLine {
  path: string
  line: number
  request: number
}

export interface ScreenSelectionState {
  selection: ScreenSelection | null
  sheetOpen: boolean
  setSheetOpen: (open: boolean) => void
  /** A symbol found by the search: its file's sheet opens its code at its line. */
  openLine: OpenLine | null
  /**
   * Selects a file or a folder from the interface: its sheet opens, the city follows. With `fly`,
   * the camera flies to it too.
   */
  choose: (next: ScreenSelection | null, options?: { fly?: boolean }) => void
  /** The engine's listener: a click in the city selects and opens the sheet, on the sea clears both. */
  selectFromCity: (item: CityItem | null) => void
  openAtLine: (path: string, line: number) => void
}

/** What is selected, in the city and the interface alike, and whether its sheet is open. */
export function useScreenSelection(
  engine: CityEngine | null,
  index: ResultIndex,
): ScreenSelectionState {
  const [selection, setSelection] = useState<ScreenSelection | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [openLine, setOpenLine] = useState<OpenLine | null>(null)
  const openLineRequest = useRef(0)
  // Set while the screen moves the engine's selection: it does not hear its own move back.
  const driving = useRef(false)

  const selectFromCity = useCallback((item: CityItem | null) => {
    if (driving.current) {
      return
    }
    setSelection(
      item ? { kind: item.target.kind === 'building' ? 'file' : 'dir', path: item.path } : null,
    )
    setSheetOpen(item !== null)
    setOpenLine(null)
  }, [])

  const choose = useCallback(
    (next: ScreenSelection | null, { fly = false }: { fly?: boolean } = {}) => {
      // A path the result does not hold selects nothing.
      const known =
        next &&
        (next.kind === 'file' ? index.fileAt(next.path) : index.folderAt(next.path)) !== undefined
          ? next
          : null
      setSelection(known)
      setSheetOpen(known !== null)
      setOpenLine(null)
      if (!engine) {
        return
      }
      driving.current = true
      try {
        // A folder that holds islands has no place of its own in the city.
        const shown = known && (fly ? engine.flyTo(known.path) : engine.selectPath(known.path))
        if (!shown) {
          engine.clearSelection()
        }
      } finally {
        driving.current = false
      }
    },
    [engine, index],
  )

  const openAtLine = useCallback((path: string, line: number) => {
    openLineRequest.current++
    setOpenLine({ path, line, request: openLineRequest.current })
  }, [])

  return { selection, sheetOpen, setSheetOpen, openLine, choose, selectFromCity, openAtLine }
}
