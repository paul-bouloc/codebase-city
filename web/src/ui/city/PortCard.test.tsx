import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PortCard } from './PortCard'

const LINKS = [
  { path: 'src/vs/code', imports: 418, outgoing: false, incoming: true },
  { path: 'src/vs', imports: 287, outgoing: true, incoming: false },
  { path: 'src/vs/editor', imports: 1, outgoing: true, incoming: true },
]

describe('PortCard', () => {
  it('names the port’s island and says why its links wait there', () => {
    const html = renderToStaticMarkup(
      <PortCard path="src/vs/platform" links={LINKS} more={0} pointer={{ x: 0, y: 0 }} />,
    )
    expect(html).toContain('aria-label="Links at the port of src/vs/platform"')
    expect(html).toContain('>platform</span>')
    expect(html).toContain('>src/vs/</span>')
    expect(html).toContain('These 3 links aren’t drawn on the map: they wait at this port.')
    expect(html).not.toContain('and ')
  })

  it('lists each link with its imports, its island and the way it goes, in words', () => {
    const html = renderToStaticMarkup(
      <PortCard path="src/vs/platform" links={LINKS} more={0} pointer={{ x: 0, y: 0 }} />,
    )
    expect(html).toContain('>418</span>')
    expect(html).toContain('418 imports')
    expect(html).toContain('>code</span>')
    expect(html).toContain('imports platform')
    expect(html).toContain('imported by platform')
    expect(html).toContain('both ways')
    expect(html).toContain('1 import<')
  })

  it('counts the links past those listed', () => {
    const html = renderToStaticMarkup(
      <PortCard path="src" links={LINKS} more={5} pointer={{ x: 0, y: 0 }} />,
    )
    expect(html).toContain('These 8 links')
    expect(html).toContain('and 5 more')
  })

  it('speaks of one link alone', () => {
    const html = renderToStaticMarkup(
      <PortCard path="gin" links={LINKS.slice(0, 1)} more={0} pointer={{ x: 0, y: 0 }} />,
    )
    expect(html).toContain('This link isn’t drawn on the map: it waits at this port.')
  })
})
