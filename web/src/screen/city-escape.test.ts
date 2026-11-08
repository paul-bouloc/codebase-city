import { describe, expect, it } from 'vitest'
import { escapeTarget } from './city-escape'

describe('escapeTarget', () => {
  it('closes the panel first, then clears the selection', () => {
    expect(escapeTarget({ panelOpen: true, hasSelection: true })).toBe('panel')
    expect(escapeTarget({ panelOpen: false, hasSelection: true })).toBe('selection')
  })

  it('does nothing when nothing is open or selected', () => {
    expect(escapeTarget({ panelOpen: false, hasSelection: false })).toBeNull()
  })
})
