import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CitySearchField } from './CitySearchField'

const render = (value: string, expanded = false) =>
  renderToStaticMarkup(
    <CitySearchField
      value={value}
      onChange={() => {}}
      expanded={expanded}
      listboxId="results"
      activeDescendant="results-option-0"
    />,
  )

describe('CitySearchField', () => {
  it('is a combobox inside a search landmark', () => {
    const html = render('')
    expect(html).toMatch(/^<search aria-label="Search files, folders and symbols"/)
    expect(html).toContain('role="combobox"')
    expect(html).toContain('aria-expanded="false"')
  })

  it('points at the results only while they are open', () => {
    expect(render('term')).not.toContain('aria-controls')
    expect(render('term', true)).toContain('aria-controls="results"')
  })

  it('points at the active option only while the results are open', () => {
    expect(render('term')).not.toContain('aria-activedescendant')
    expect(render('term', true)).toContain('aria-activedescendant="results-option-0"')
  })

  it('shows the / key at rest and the clear button once typed into', () => {
    expect(render('')).toContain('<kbd')
    expect(render('')).not.toContain('Clear search')
    expect(render('term')).toContain('aria-label="Clear search"')
    expect(render('term')).not.toContain('<kbd')
  })
})
