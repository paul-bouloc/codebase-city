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
    expect(html).toContain('>common</span>')
    expect(html).toContain('612 files · in editor, layer 3')
  })

  it('gives the layer alone for an island', () => {
    const html = renderToStaticMarkup(
      <AreaTooltip path="src" files={15212} layer={1} pointer={{ x: 0, y: 0 }} />,
    )
    expect(html).toContain('15,212 files · layer 1')
  })
})
