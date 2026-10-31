import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Kbd } from './Kbd'

describe('Kbd', () => {
  it('renders a native kbd element', () => {
    expect(renderToStaticMarkup(<Kbd>Esc</Kbd>)).toMatch(/^<kbd [^>]*>Esc<\/kbd>$/)
  })

  it('adds a class for the inverse tone only', () => {
    const plain = renderToStaticMarkup(<Kbd>F</Kbd>)
    const inverse = renderToStaticMarkup(<Kbd tone="inverse">F</Kbd>)
    expect(plain).toMatch(/class="[^" ]+"/)
    expect(inverse).toMatch(/class="[^" ]+ [^" ]+"/)
  })
})
