import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CodeView } from './CodeView'
import type { CodeState } from './sheet-data'

const render = (code: CodeState) =>
  renderToStaticMarkup(<CodeView code={code} githubUrl="https://github.com/x" onRetry={() => {}} />)

describe('CodeView', () => {
  it('says how much of a long file is shown and links to the rest', () => {
    const html = render({ status: 'ready', lines: ['a', 'b'], totalLines: 2481 })
    expect(html).toContain('Showing lines 1–2 of 2,481.')
    expect(html).toContain('Open the full file on GitHub')
  })

  it('says the whole file is there when it is', () => {
    expect(render({ status: 'ready', lines: ['a', 'b'], totalLines: 2 })).toContain('All 2 lines.')
  })

  it('hides the line numbers from screen readers and escapes the code', () => {
    const html = render({ status: 'ready', lines: ['<script>'], totalLines: 1 })
    expect(html).toMatch(/<pre [^>]*aria-hidden="true">1<\/pre>/)
    expect(html).toContain('&lt;script&gt;')
  })

  it('writes the second line of the error after its cause', () => {
    const timeout = render({ status: 'error', cause: 'timeout' })
    const gone = render({ status: 'error', cause: 'gone' })
    expect(timeout).toContain('role="alert"')
    expect(timeout).toContain('didn’t answer in time')
    expect(gone).toContain('isn’t on GitHub at the analyzed commit anymore')
    expect(gone).toContain('Try again')
  })

  it('highlights a shown line, and links to GitHub for a line past them', () => {
    const shown = renderToStaticMarkup(
      <CodeView
        code={{ status: 'ready', lines: ['a', 'b', 'c'], totalLines: 9 }}
        githubUrl="https://github.com/x"
        onRetry={() => {}}
        line={2}
      />,
    )
    expect(shown).toContain('--line-index:1')
    const past = renderToStaticMarkup(
      <CodeView
        code={{ status: 'ready', lines: ['a'], totalLines: 9 }}
        githubUrl="https://github.com/x"
        onRetry={() => {}}
        line={2196}
      />,
    )
    expect(past).toContain('Line 2,196 is past the lines shown here.')
    expect(past).toContain('href="https://github.com/x#L2196"')
  })
})
