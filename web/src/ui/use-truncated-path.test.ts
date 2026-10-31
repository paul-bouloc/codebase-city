import { describe, expect, it } from 'vitest'
import { canvasFont } from './use-truncated-path'

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
