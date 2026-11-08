import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PortTooltip } from './PortTooltip'

describe('PortTooltip', () => {
  it('says how many links the port gathers, and what a click shows', () => {
    const html = renderToStaticMarkup(
      <PortTooltip path="src/vs/base" links={17} pointer={{ x: 0, y: 0 }} />,
    )
    expect(html).toContain('>base</span>')
    expect(html).toContain('17 links to other islands not drawn')
    expect(html).toContain('Only an island’s largest links are drawn. The others wait at its port.')
    expect(html).toContain('Click to show them')
  })

  it('speaks of one link alone', () => {
    const html = renderToStaticMarkup(<PortTooltip path="gin" links={1} pointer={{ x: 0, y: 0 }} />)
    expect(html).toContain('1 link to other islands not drawn')
    expect(html).toContain('Click to show it')
  })
})
