export interface EscapeState {
  // A sheet, the About panel, the legend or another panel is open.
  panelOpen: boolean
  hasSelection: boolean
}

// Esc in two steps: it closes the open panel first, then clears the selection.
export function escapeTarget({
  panelOpen,
  hasSelection,
}: EscapeState): 'panel' | 'selection' | null {
  if (panelOpen) {
    return 'panel'
  }
  return hasSelection ? 'selection' : null
}
