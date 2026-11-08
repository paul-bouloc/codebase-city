import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PortCard } from './PortCard'

const LINKS = [
  { path: 'src/vs/platform', imports: 212, outgoing: true, incoming: true },
  { path: 'src/vs/editor', imports: 1, outgoing: false, incoming: true },
]

describe('PortCard', () => {
  it('lists the links of a port, each with its island, its imports and its ways', () => {
    const html = renderToStaticMarkup(
      <PortCard path="src/vs/base" links={LINKS} more={0} pointer={{ x: 0, y: 0 }} />,
    )
    expect(html).toContain('aria-label="Links at the port of src/vs/base"')
    expect(html).toContain('2 more links')
    expect(html).toContain('src/vs/platform</span>')
    expect(html).toContain('212 imports')
    expect(html).toContain('1 import<')
    // Two strokes for the link both ways, one for the other.
    expect(html.match(/title="imports it"/g)).toHaveLength(1)
    expect(html.match(/title="imported by it"/g)).toHaveLength(2)
    expect(html).not.toContain('and ')
  })

  it('counts the links past those listed', () => {
    const html = renderToStaticMarkup(
      <PortCard path="src" links={LINKS} more={5} pointer={{ x: 0, y: 0 }} />,
    )
    expect(html).toContain('7 more links')
    expect(html).toContain('and 5 more')
  })
})
