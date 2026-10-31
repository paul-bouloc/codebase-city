import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SheetFrame } from './SheetFrame'

const render = (open: boolean, footer?: string) =>
  renderToStaticMarkup(
    <SheetFrame
      open={open}
      onClose={() => {}}
      breadcrumb={<nav aria-label="Path" />}
      icon="file"
      tone="accent"
      title="textModel.ts"
      actions={<button type="button">Open on GitHub</button>}
      footer={footer}
    >
      Body
    </SheetFrame>,
  )

describe('SheetFrame', () => {
  it('is a region named by its focusable title', () => {
    const html = render(true)
    const titleId = html.match(/<h2 [^>]*id="([^"]+)"/)?.[1]
    expect(html).toMatch(new RegExp(`^<section [^>]*aria-labelledby="${titleId}"`))
    expect(html).toMatch(/<h2 [^>]*tabindex="-1"/)
  })

  it('stays in the page while closed, but inert', () => {
    expect(render(false)).toMatch(/^<section [^>]*inert=""/)
    expect(render(true)).not.toContain('inert')
  })

  it('names the close button and its shortcut', () => {
    const html = render(true)
    expect(html).toContain('aria-label="Close"')
    expect(html).toContain('aria-keyshortcuts="Escape"')
    expect(html).toMatch(/<kbd [^>]*>Esc<\/kbd>/)
  })

  it('pins a footer only when there is one', () => {
    expect(render(true)).not.toContain('<footer')
    expect(render(true, 'Show impact')).toContain('<footer')
  })
})
