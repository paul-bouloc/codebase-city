import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AnalysisProgress, progressStatus, stepStates } from './AnalysisProgress'

describe('stepStates', () => {
  it('marks the steps before, at and after the current one', () => {
    expect(stepStates('parsing', 'running')).toEqual([
      'done',
      'done',
      'done',
      'current',
      'upcoming',
      'upcoming',
      'upcoming',
    ])
  })

  it('marks where a build failed or was cancelled', () => {
    expect(stepStates('downloading', 'failed').slice(0, 3)).toEqual(['done', 'failed', 'upcoming'])
    expect(stepStates('queued', 'cancelled')[0]).toBe('cancelled')
  })

  it('marks every step done once the city is built', () => {
    expect(stepStates('building', 'done').every((state) => state === 'done')).toBe(true)
  })
})

describe('progressStatus', () => {
  it('stays Building while waiting on GitHub or reconnecting', () => {
    expect(progressStatus('queued', 'running')).toBe('queued')
    expect(progressStatus('downloading', 'paused')).toBe('building')
    expect(progressStatus('parsing', 'reconnecting')).toBe('building')
    expect(progressStatus('mapping', 'failed')).toBe('failed')
  })
})

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
