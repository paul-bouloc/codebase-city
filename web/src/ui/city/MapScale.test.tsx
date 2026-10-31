import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MapScale } from './MapScale'

describe('MapScale', () => {
  it('is one image named by its value', () => {
    const html = renderToStaticMarkup(<MapScale files={1500} />)
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Scale: this bar spans about 1,500 files"')
    expect(html).toContain('≈ 1,500 files')
  })

  it('says file for one file', () => {
    expect(renderToStaticMarkup(<MapScale files={1} />)).toContain('≈ 1 file<')
  })
})
