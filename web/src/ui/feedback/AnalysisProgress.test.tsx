import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AnalysisProgress } from './AnalysisProgress'

describe('AnalysisProgress', () => {
  it('tells screen readers the state of each step', () => {
    const html = renderToStaticMarkup(
      <AnalysisProgress
        repo="microsoft/vscode"
        step="parsing"
        progress={{ value: 9840, max: 15212, label: 'Parsing files' }}
      />,
    )
    expect(html).toContain('aria-current="step"')
    expect(html).toContain(', in progress')
    expect(html).toContain(', upcoming')
    expect(html).toContain('<progress')
  })

  it('shows the repository name in bold, with or without its owner', () => {
    expect(
      renderToStaticMarkup(<AnalysisProgress repo="microsoft/vscode" step="queued" />),
    ).toContain('microsoft/<b>vscode</b>')
    expect(renderToStaticMarkup(<AnalysisProgress repo="vscode" step="queued" />)).toContain(
      '<b>vscode</b>',
    )
  })
})
