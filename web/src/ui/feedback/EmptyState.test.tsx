import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('describes its illustration', () => {
    const html = renderToStaticMarkup(
      <EmptyState title="No cities yet">Paste a repository.</EmptyState>,
    )
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="An empty island waiting for a city"')
  })

  it('drops the illustration when compact', () => {
    const html = renderToStaticMarkup(
      <EmptyState title="No files match" compact>
        Try a folder name.
      </EmptyState>,
    )
    expect(html).not.toContain('<svg')
  })
})
