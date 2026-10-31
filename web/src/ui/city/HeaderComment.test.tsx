import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HeaderComment } from './HeaderComment'

const comment = Array.from({ length: 17 }, (_, index) => ` * line ${index + 1}`).join('\n')

describe('HeaderComment', () => {
  it('folds after 12 lines and says how many are left', () => {
    const html = renderToStaticMarkup(<HeaderComment text={comment} />)
    expect(html).toContain('line 12')
    expect(html).not.toContain('line 13')
    expect(html).toMatch(/aria-expanded="false"[^>]*>Show 5 more lines</)
  })

  it('shows every line once unfolded, and offers to fold back', () => {
    const html = renderToStaticMarkup(<HeaderComment text={comment} defaultExpanded />)
    expect(html).toContain('line 17')
    expect(html).toMatch(/aria-expanded="true"[^>]*>Show fewer lines</)
  })

  it('has no button for a short comment, and escapes it', () => {
    const html = renderToStaticMarkup(<HeaderComment text="<b>not bold</b>" />)
    expect(html).not.toContain('<button')
    expect(html).toContain('&lt;b&gt;not bold&lt;/b&gt;')
  })
})
