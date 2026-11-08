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
  it('has one toggle, pointing at a body that is always in the page', () => {
    for (const expanded of [false, true]) {
      const html = render(expanded)
      const controls = [...html.matchAll(/aria-controls="([^"]+)"/g)].map((match) => match[1])
      expect(controls).toHaveLength(1)
      expect(html).toContain(`id="${controls[0]}"`)
      expect(html).toContain(`aria-expanded="${expanded}"`)
    }
  })

  it('makes the folded body inert', () => {
    expect(render(false)).toMatch(/<div id="[^"]+" class="[^"]+" inert=""/)
    expect(render(true)).not.toContain('inert')
  })

  it('shows three language dots in the header', () => {
    const header = render(false).split('</h2>')[0] ?? ''
    expect(header.match(/data-language=/g)).toHaveLength(3)
  })

  it('names the legend after its header', () => {
    const html = render(true)
    const titleId = html.match(/<button [^>]*id="([^"]+)"/)?.[1]
    expect(html).toMatch(new RegExp(`^<section [^>]*aria-labelledby="${titleId}"`))
  })

  it('leaves out the groups this city has nothing for', () => {
    const html = render(true, { languages: [], tests: false, places: ['canal'], landmarks: [] })
    expect(html).not.toContain('Languages in this repo')
    expect(html).not.toContain('Landmarks')
    expect(html).toContain('Canal · border between sub-folders')
  })
})
