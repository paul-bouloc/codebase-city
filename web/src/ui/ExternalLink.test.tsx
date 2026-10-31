import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ExternalLink } from './ExternalLink'

describe('ExternalLink', () => {
  it('opens in a new tab, cut off from the city, and says so', () => {
    const html = renderToStaticMarkup(<ExternalLink href="https://github.com">README</ExternalLink>)
    expect(html).toMatch(
      /^<a target="_blank" rel="noopener noreferrer" href="https:\/\/github.com">README/,
    )
    expect(html).toContain('<span class="visually-hidden"> (opens in a new tab)</span>')
  })
})
