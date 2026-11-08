import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RoleBadge } from './RoleBadge'

describe('RoleBadge', () => {
  it('always says likely, and points at a tooltip that gives the reason', () => {
    const html = renderToStaticMarkup(
      <RoleBadge fileRole="conductor" reason="Depends on 4,800 files, directly or not." />,
    )
    expect(html).toMatch(/<button [^>]*>.*Conductor.*· likely.*<\/button>/)
    const tipId = html.match(/aria-describedby="([^"]+)"/)?.[1]
    expect(html).toContain(`id="${tipId}" role="tooltip"`)
    expect(html).toContain('Depends on 4,800 files, directly or not.')
    expect(html).toContain('Measured from imports.')
  })
})
