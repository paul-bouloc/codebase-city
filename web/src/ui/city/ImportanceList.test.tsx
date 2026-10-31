import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ImportanceList } from './ImportanceList'

const rows = Array.from({ length: 38 }, (_, index) => ({
  path: `src/vs/base/common/file${index}.ts`,
  importers: 1000 - index,
}))

const render = (defaultExpanded: boolean) =>
  renderToStaticMarkup(
    <ImportanceList
      rows={rows}
      direction="imports"
      onSelect={() => {}}
      defaultExpanded={defaultExpanded}
    />,
  )

describe('ImportanceList', () => {
  it('shows 8 rows and offers the rest', () => {
    const html = render(false)
    expect(html.match(/<li>/g)).toHaveLength(8)
    expect(html).toContain('Show all (38)')
    expect(html).toContain('used by 1,000')
  })

  it('shows every row once expanded, without the button', () => {
    const html = render(true)
    expect(html.match(/<li>/g)).toHaveLength(38)
    expect(html).not.toContain('Show all')
    expect(html).toContain('Sorted by importance')
  })
})
