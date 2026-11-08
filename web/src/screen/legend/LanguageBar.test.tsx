import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LanguageBar } from './LanguageBar'

describe('LanguageBar', () => {
  it('is one image that reads the shares, small ones in words', () => {
    const html = renderToStaticMarkup(
      <LanguageBar
        languages={[
          { language: 'typescript', share: 0.96 },
          { language: 'css', share: 0.03 },
          { language: 'other', share: 0.001 },
        ]}
      />,
    )
    expect(html).toMatch(/^<span role="img" aria-label="TypeScript 96%, CSS 3%, Other under 1%"/)
    expect(html.match(/data-language=/g)).toHaveLength(3)
  })
})
