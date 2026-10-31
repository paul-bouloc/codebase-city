import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Dialog } from './Dialog'

describe('Dialog', () => {
  it('is named by its title and closed until shown as a modal', () => {
    const html = renderToStaticMarkup(
      <Dialog open={false} onClose={() => {}} title="Delete your account?">
        <p>This can’t be undone.</p>
      </Dialog>,
    )
    const labelledBy = html.match(/aria-labelledby="([^"]+)"/)?.[1]
    expect(labelledBy).toBeDefined()
    expect(html).toContain(`id="${labelledBy}"`)
    expect(html).not.toContain(' open=')
    expect(html).toContain('aria-label="Close"')
  })
})
