import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { filledSegments, QuotaIndicator, quotaTone } from './QuotaIndicator'

describe('quotaTone', () => {
  it('warns from 2 left and runs out at 0', () => {
    expect(quotaTone(3)).toBe('available')
    expect(quotaTone(2)).toBe('low')
    expect(quotaTone(1)).toBe('low')
    expect(quotaTone(0)).toBe('exhausted')
  })
})

describe('filledSegments', () => {
  it('maps the quota onto ten segments', () => {
    expect(filledSegments(7, 10)).toBe(7)
    expect(filledSegments(10, 20)).toBe(5)
    expect(filledSegments(30, 20)).toBe(10)
  })

  it('shows one segment while anything is left', () => {
    expect(filledSegments(1, 50)).toBe(1)
    expect(filledSegments(0, 10)).toBe(0)
    expect(filledSegments(-1, 10)).toBe(0)
  })
})

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
