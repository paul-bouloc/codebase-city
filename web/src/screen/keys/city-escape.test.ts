import { describe, expect, it } from 'vitest'
import { escapeTarget } from './city-escape'

const NOTHING = { panelOpen: false, hasSelection: false, guideOpen: false }

describe('escapeTarget', () => {
  it('closes the panel first, then clears the selection, then folds the guide', () => {
    const all = { panelOpen: true, hasSelection: true, guideOpen: true }
    expect(escapeTarget(all)).toBe('panel')
    expect(escapeTarget({ ...all, panelOpen: false })).toBe('selection')
    expect(escapeTarget({ ...NOTHING, guideOpen: true })).toBe('guide')
  })

  it('leaves an answer for the questions before the selection', () => {
    const answer = { panelOpen: false, hasSelection: true, guideOpen: true, answerOpen: true }
    expect(escapeTarget(answer)).toBe('answer')
    expect(escapeTarget({ ...answer, panelOpen: true })).toBe('panel')
  })

  it('does nothing when nothing is open or selected', () => {
    expect(escapeTarget(NOTHING)).toBeNull()
  })
})
