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
})
