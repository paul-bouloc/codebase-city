import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Badge } from './Badge'

describe('Badge', () => {
  it('names a role and marks a likely one', () => {
    expect(renderToStaticMarkup(<Badge kind="role" fileRole="entry-point" />)).toContain(
      'Entry point',
    )
    const likely = renderToStaticMarkup(<Badge kind="role" fileRole="conductor" likely />)
    expect(likely).toContain('Conductor · likely')
  })

  it('always writes the language name next to its dot', () => {
    const html = renderToStaticMarkup(<Badge kind="language" language="other" />)
    expect(html).toContain('Not analyzed')
    expect(html).toContain('data-language="other"')
  })

  it('pairs every status with a word and a hidden icon', () => {
    for (const [status, word] of [
      ['queued', 'Queued'],
      ['building', 'Building'],
      ['done', 'Done'],
      ['failed', 'Failed'],
      ['cancelled', 'Cancelled'],
    ] as const) {
      const html = renderToStaticMarkup(<Badge kind="status" status={status} />)
      expect(html).toContain(word)
      expect(html).toContain('aria-hidden="true"')
    }
  })
})
