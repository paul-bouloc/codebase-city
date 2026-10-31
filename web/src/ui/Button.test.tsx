import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('is a plain button by default', () => {
    const html = renderToStaticMarkup(<Button>Share</Button>)
    expect(html).toContain('type="button"')
    expect(html).not.toContain('aria-busy')
    expect(html).not.toContain('aria-disabled')
  })

  it('names an icon-only button with its label', () => {
    const html = renderToStaticMarkup(<Button iconOnly icon="share" label="Share this city" />)
    expect(html).toContain('aria-label="Share this city"')
    expect(html).toContain('aria-hidden="true"')
  })

  it('announces loading and keeps both labels for a stable width', () => {
    const html = renderToStaticMarkup(
      <Button variant="primary" loading loadingLabel="Starting…">
        Build the city
      </Button>,
    )
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('Build the city')
    expect(html).toContain('Starting…')
    expect(html).not.toContain('disabled=""')
  })

  it('stays focusable when blocked for a reason', () => {
    const html = renderToStaticMarkup(<Button blocked>Build the city</Button>)
    expect(html).toContain('aria-disabled="true"')
    expect(html).not.toContain('disabled=""')
  })

  it('passes the native disabled state through', () => {
    const html = renderToStaticMarkup(<Button disabled>Share</Button>)
    expect(html).toContain('disabled=""')
  })

  // Checked by `pnpm typecheck`: it fails if any of these lines type-checks.
  it('rejects invalid props at compile time', () => {
    const rejected = [
      // @ts-expect-error an icon-only button needs a label
      <Button key="no-label" iconOnly icon="share" />,
      // @ts-expect-error an icon-only button needs an icon
      <Button key="no-icon" iconOnly label="Share" />,
      // @ts-expect-error a labelled button takes its text as children
      <Button key="stray-label" label="Share">
        Share
      </Button>,
      // @ts-expect-error unknown variant
      <Button key="odd-variant" variant="link">
        Share
      </Button>,
    ]
    expect(rejected).toHaveLength(4)
  })
})
