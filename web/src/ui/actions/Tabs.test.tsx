import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { type TabItem, Tabs } from './Tabs'

const TABS: TabItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'imports', label: 'Imports', count: 38 },
  { id: 'imported-by', label: 'Imported by', count: 1204 },
  { id: 'history', label: 'History', disabled: true },
]

const render = (selected = 'overview') =>
  renderToStaticMarkup(
    <Tabs label="File sheet" tabs={TABS} selected={selected} onSelect={() => {}}>
      Panel content
    </Tabs>,
  )

describe('Tabs', () => {
  it('renders a labelled tab list and one panel', () => {
    const html = render()
    expect(html).toContain('role="tablist" aria-label="File sheet"')
    expect(html.match(/role="tab"/g)).toHaveLength(4)
    expect(html.match(/role="tabpanel"/g)).toHaveLength(1)
    expect(html).toContain('Panel content')
  })

  it('gives the selected tab the only tab stop and links it to the panel', () => {
    const html = render('imports')
    const selectedTab = html.match(/<button[^>]*aria-selected="true"[^>]*>/)?.[0] ?? ''
    expect(selectedTab).toContain('tabindex="0"')
    const tabId = selectedTab.match(/id="([^"]+)"/)?.[1]
    const panelId = selectedTab.match(/aria-controls="([^"]+)"/)?.[1]
    expect(html).toContain(`id="${panelId}" role="tabpanel" aria-labelledby="${tabId}"`)
    expect(html.match(/tabindex="-1"/g)).toHaveLength(3)
  })

  it('keeps a tab stop when the selected tab is unknown or disabled', () => {
    for (const selected of ['missing', 'history']) {
      const firstTab = render(selected).match(/<button[^>]*>Overview/)?.[0] ?? ''
      expect(firstTab).toContain('tabindex="0"')
    }
  })

  it('formats counts with thousands separators', () => {
    expect(render()).toContain('1,204')
  })

  it('disables a tab natively', () => {
    expect(render()).toMatch(/disabled=""[^>]*>History/)
  })

  it('shortens large counts in compact tabs but reads them in full', () => {
    const html = renderToStaticMarkup(
      <Tabs
        label="File details"
        compact
        tabs={[
          { id: 'a', label: 'Imported by', count: 12_345 },
          { id: 'b', label: 'Imports', count: 38 },
        ]}
        selected="a"
        onSelect={() => {}}
      >
        Panel
      </Tabs>,
    )
    expect(html).toMatch(/title="12,345" aria-hidden="true">12k</)
    expect(html).toContain('<span class="visually-hidden">12,345</span>')
    expect(html).toMatch(/>38</)
  })
})
