import { describe, expect, it } from 'vitest'
import { canvasFont, maxCharsFor } from './use-truncated-path'

describe('maxCharsFor', () => {
  it('never rounds the budget up', () => {
    // 300.6 px rounded to 301 would let a 42nd character of 7.2 px through.
    expect(maxCharsFor(300.6, 7.2)).toBe(41)
    expect(maxCharsFor(302.4, 7.2)).toBe(42)
  })

  it('stops truncating when the font cannot be measured', () => {
    expect(maxCharsFor(300, 0)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('canvasFont', () => {
  it('rebuilds the font from its longhands', () => {
    const font = canvasFont({
      fontStyle: 'normal',
      fontWeight: '400',
      fontSize: '12px',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    })
    expect(font).toBe('normal 400 12px "JetBrains Mono", ui-monospace, monospace')
  })
})
