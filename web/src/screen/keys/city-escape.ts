export interface EscapeState {
  // A sheet, the About panel, the legend or another panel is open.
  panelOpen: boolean
  hasSelection: boolean
  // The guide is open, or touring.
  guideOpen: boolean
}

// Esc in three steps: it closes the open panel first, then clears the selection, then folds the
// guide: during the tour, what a chip opened goes before the tour.
export function escapeTarget({
  panelOpen,
  hasSelection,
  guideOpen,
}: EscapeState): 'panel' | 'selection' | 'guide' | null {
  if (panelOpen) {
    return 'panel'
  }
  if (hasSelection) {
    return 'selection'
  }
  return guideOpen ? 'guide' : null
}
