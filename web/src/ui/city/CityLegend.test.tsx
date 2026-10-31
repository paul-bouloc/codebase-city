import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CityLegend } from './CityLegend'
import type { LegendContent } from './legend-content'

const CONTENT: LegendContent = {
  languages: [
    { language: 'typescript', share: '94%' },
    { language: 'javascript', share: '3%' },
    { language: 'css', share: '2%' },
    { language: 'other', share: '1%' },
  ],
  tests: true,
  places: ['bridge', 'upward'],
  landmarks: ['entry-point'],
}

const render = (expanded: boolean, content = CONTENT) =>
  renderToStaticMarkup(
    <CityLegend content={content} expanded={expanded} onExpandedChange={() => {}} />,
  )

describe('CityLegend', () => {
  // A-c14: the board pointed `aria-controls` at an element that did not exist.
  it('points both toggles at the panel, which is always in the page', () => {
    for (const expanded of [false, true]) {
      const html = render(expanded)
      const panelId = html.match(/<section [^>]*id="([^"]+)"/)?.[1]
      expect(panelId).toBeDefined()
      expect(html.match(new RegExp(`aria-controls="${panelId}"`, 'g'))).toHaveLength(2)
    }
  })

  it('hides the pill or the panel, never both', () => {
    expect(render(false)).toMatch(/<section [^>]*hidden=""/)
    expect(render(true)).not.toMatch(/<section [^>]*hidden=""/)
    expect(render(true)).toMatch(/<div [^>]*hidden=""/)
  })

  it('shows three language dots on the pill', () => {
    const pill = render(false).split('<section')[0] ?? ''
    expect(pill.match(/data-language=/g)).toHaveLength(3)
  })

  it('names the panel after its title', () => {
    const html = render(true)
    const titleId = html.match(/<h2 id="([^"]+)"/)?.[1]
    expect(html).toContain(`aria-labelledby="${titleId}"`)
  })

  it('leaves out the groups this city has nothing for', () => {
    const html = render(true, { languages: [], tests: false, places: ['canal'], landmarks: [] })
    expect(html).not.toContain('Languages in this repo')
    expect(html).not.toContain('Landmarks')
    expect(html).toContain('Canal · border between sub-folders')
  })
})
