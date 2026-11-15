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

  it('does nothing when nothing is open or selected', () => {
    expect(escapeTarget(NOTHING)).toBeNull()
  })
})
