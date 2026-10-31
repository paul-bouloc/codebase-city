import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { QuotaIndicator } from './QuotaIndicator'

describe('QuotaIndicator', () => {
  it('describes the meter in words', () => {
    const html = renderToStaticMarkup(<QuotaIndicator left={7} limit={10} />)
    expect(html).toContain('7 of 10 analyses left today')
    expect(html).toContain('<meter')
    expect(html).toContain('value="7"')
  })

  it('says when nothing is left', () => {
    expect(renderToStaticMarkup(<QuotaIndicator left={0} limit={10} />)).toContain(
      'No analyses left today',
    )
    expect(renderToStaticMarkup(<QuotaIndicator variant="chip" left={2} limit={10} />)).toContain(
      '2 left today',
    )
  })
})
