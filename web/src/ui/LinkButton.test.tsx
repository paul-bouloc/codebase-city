import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LinkButton } from './LinkButton'

describe('LinkButton', () => {
  it('is a real link', () => {
    const html = renderToStaticMarkup(
      <LinkButton href="https://github.com">Open on GitHub</LinkButton>,
    )
    expect(html).toMatch(/^<a class="[^"]+" href="https:\/\/github.com">/)
    expect(html).toContain('Open on GitHub')
  })

  it('opens another site in a new tab and says so', () => {
    const html = renderToStaticMarkup(
      <LinkButton href="https://github.com" newTab>
        Open on GitHub
      </LinkButton>,
    )
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('(opens in a new tab)')
  })
})
