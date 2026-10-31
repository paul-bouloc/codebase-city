import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Glass } from './Glass'

describe('Glass', () => {
  it('renders the requested element and keeps the caller class', () => {
    const html = renderToStaticMarkup(
      <Glass as="section" className="panel" aria-label="Legend">
        Text
      </Glass>,
    )
    expect(html).toMatch(/^<section class="[^"]+ panel" aria-label="Legend">Text<\/section>$/)
  })

  it('is a div by default', () => {
    expect(renderToStaticMarkup(<Glass />)).toMatch(/^<div /)
  })

  it('adds a class only for the medium radius', () => {
    const lg = renderToStaticMarkup(<Glass />)
    const md = renderToStaticMarkup(<Glass radius="md" />)
    expect(lg).toMatch(/class="[^" ]+"/)
    expect(md).toMatch(/class="[^" ]+ [^" ]+"/)
  })
})
