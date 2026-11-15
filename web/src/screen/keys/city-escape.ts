export interface EscapeState {
  // A sheet, the About panel, the legend or another panel is open.
  panelOpen: boolean
  hasSelection: boolean
  // The guide is open, or touring.
  guideOpen: boolean
  // The guide shows the answer to a question.
  answerOpen?: boolean
}

// Esc in steps: it closes the open panel first, then leaves an answer for the questions, then
// clears the selection, then folds the guide: during the tour, what a chip opened goes before
// the tour.
export function escapeTarget({
  panelOpen,
  hasSelection,
  guideOpen,
  answerOpen = false,
}: EscapeState): 'panel' | 'answer' | 'selection' | 'guide' | null {
  if (panelOpen) {
    return 'panel'
  }
  if (answerOpen) {
    return 'answer'
  }
  if (hasSelection) {
    return 'selection'
  }
  return guideOpen ? 'guide' : null
}
