import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Icon } from './Icon'

describe('Icon', () => {
  it('is hidden from assistive technologies by default', () => {
    const html = renderToStaticMarkup(<Icon name="close" />)
    expect(html).toContain('aria-hidden="true"')
    expect(html).not.toContain('role="img"')
  })

  it('is announced with its label when standalone', () => {
    const html = renderToStaticMarkup(<Icon name="close" standalone label="Close" />)
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Close"')
    expect(html).not.toContain('aria-hidden')
  })

  it('renders the GitHub mark as a filled shape', () => {
    const html = renderToStaticMarkup(<Icon name="github" size={20} />)
    expect(html).toContain('fill="currentColor"')
    expect(html).toContain('width="20"')
  })

  // Checked by `pnpm typecheck`: it fails if any of these lines type-checks.
  it('rejects invalid props at compile time', () => {
    const rejected = [
      // @ts-expect-error unknown icon name
      <Icon key="unknown" name="rocket" />,
      // @ts-expect-error a standalone icon needs a label
      <Icon key="no-label" name="close" standalone />,
      // @ts-expect-error a decorative icon takes no label
      <Icon key="stray-label" name="close" label="Close" />,
      // @ts-expect-error sizes are 14, 16, 18, 20 and 24
      <Icon key="odd-size" name="close" size={22} />,
    ]
    expect(rejected).toHaveLength(4)
  })
})
