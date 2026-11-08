import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LiveRegion } from './LiveRegion'

describe('LiveRegion', () => {
  it('is a polite region even when empty', () => {
    expect(renderToStaticMarkup(<LiveRegion />)).toBe(
      '<div aria-live="polite" aria-atomic="true"></div>',
    )
  })
})
