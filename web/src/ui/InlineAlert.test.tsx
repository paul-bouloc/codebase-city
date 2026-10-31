import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InlineAlert } from './InlineAlert'

describe('InlineAlert', () => {
  it('has no role of its own', () => {
    const html = renderToStaticMarkup(
      <InlineAlert tone="error" title="The city couldn’t be built">
        Your analysis was refunded.
      </InlineAlert>,
    )
    expect(html).not.toContain('role=')
    expect(html).toContain('Your analysis was refunded.')
  })
})
