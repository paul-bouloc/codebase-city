import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ListRow } from './ListRow'

const PATH = 'src/vs/workbench/contrib/terminal/browser/terminalInstance.ts'

describe('ListRow', () => {
  it('gives screen readers the whole path', () => {
    const html = renderToStaticMarkup(
      <ListRow name="terminalInstance.ts" path={PATH} lines={2481} incoming={1204} outgoing={38} />,
    )
    expect(html).toContain(`<span class="visually-hidden">${PATH}</span>`)
    expect(html).toMatch(/title="[^"]+" aria-hidden="true"/)
  })
})
