import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Breadcrumb } from './Breadcrumb'

const render = (folders: string[]) =>
  renderToStaticMarkup(<Breadcrumb folders={folders} onOpenFolder={() => {}} />)

const segments = (html: string) =>
  [...html.matchAll(/<button [^>]*>([^<]+)<\/button>/g)].map((match) => match[1])

describe('Breadcrumb', () => {
  it('is a navigation landmark named Path, with the whole path in its title', () => {
    const html = render(['src', 'vs', 'editor'])
    expect(html).toMatch(/^<nav aria-label="Path" [^>]*title="src\/vs\/editor"/)
    expect(segments(html)).toEqual(['src', 'vs', 'editor'])
    expect(html).not.toContain('…')
  })

  it('drops folders from the start when the path is too long', () => {
    const folders = ['src', 'vs', 'workbench', 'contrib', 'terminal', 'browser', 'media', 'shell']
    const html = render(folders)
    expect(html).toContain('>…<')
    const shown = segments(html)
    expect(shown.at(-1)).toBe('shell')
    expect(shown[0]).not.toBe('src')
    expect(shown.join(' / ').length + 4).toBeLessThanOrEqual(47)
  })

  it('renders nothing at the root', () => {
    expect(render([])).toBe('')
  })
})
