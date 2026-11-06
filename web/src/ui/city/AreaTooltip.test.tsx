import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AreaTooltip } from './AreaTooltip'

describe('AreaTooltip', () => {
  it('says where a parcel stands', () => {
    const html = renderToStaticMarkup(
      <AreaTooltip
        path="src/vs/editor/common"
        files={612}
        layer={3}
        island="editor"
        pointer={{ x: 0, y: 0 }}
      />,
    )
    expect(html).toContain('>src/vs/editor/</span>')
    expect(html).toContain('<span class="visually-hidden">src/vs/editor/common</span>')
    expect(html).toContain('>common</span>')
    expect(html).toContain('612 files · in editor, layer 3')
  })

  it('gives the layer alone for an island', () => {
    const html = renderToStaticMarkup(
      <AreaTooltip path="src" files={15212} layer={1} pointer={{ x: 0, y: 0 }} />,
    )
    expect(html).toContain('15,212 files · layer 1')
  })

  it('leaves the layer out for an island without one', () => {
    const html = renderToStaticMarkup(
      <AreaTooltip path="docs" files={40} pointer={{ x: 0, y: 0 }} />,
    )
    expect(html).toContain('>40 files</p>')
    const parcel = renderToStaticMarkup(
      <AreaTooltip path="docs/guide" files={12} island="docs" pointer={{ x: 0, y: 0 }} />,
    )
    expect(parcel).toContain('12 files · in docs<')
  })

  it('shortens a deep folder from its start, the name kept whole', () => {
    const path = 'packages/platform/services/workspace/internal/indexing/backends/sqlite/schema'
    const html = renderToStaticMarkup(
      <AreaTooltip path={path} files={3} layer={2} island="platform" pointer={{ x: 0, y: 0 }} />,
    )
    const folder = html.match(/aria-hidden="true">(…\/[^<]*)<\/span>/)?.[1] ?? ''
    expect(folder.startsWith('…/')).toBe(true)
    expect(folder.length + 'schema'.length).toBeLessThanOrEqual(45)
    expect(html).toContain('>schema</span>')
  })
})
