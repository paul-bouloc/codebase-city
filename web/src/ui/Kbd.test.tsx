import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Kbd } from './Kbd'

describe('Kbd', () => {
  it('renders a native kbd element', () => {
    expect(renderToStaticMarkup(<Kbd>Esc</Kbd>)).toMatch(/^<kbd [^>]*>Esc<\/kbd>$/)
  })
})
