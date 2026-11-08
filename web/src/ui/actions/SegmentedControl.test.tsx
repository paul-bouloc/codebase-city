import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SegmentedControl, type SegmentedOption } from './SegmentedControl'

const MODES: SegmentedOption<'simplified' | 'realistic'>[] = [
  { value: 'simplified', label: 'Simplified', icon: 'mode-simplified' },
  { value: 'realistic', label: 'Realistic', icon: 'mode-realistic' },
]

const render = (disabled = false) =>
  renderToStaticMarkup(
    <SegmentedControl
      label="Building style"
      options={MODES}
      value="realistic"
      onChange={() => {}}
      disabled={disabled}
    />,
  )

describe('SegmentedControl', () => {
  it('is a labelled group of native radios sharing one name', () => {
    const html = render()
    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('aria-label="Building style"')
    const names = [...html.matchAll(/type="radio"[^>]*name="([^"]+)"/g)].map((match) => match[1])
    expect(names).toHaveLength(2)
    expect(new Set(names).size).toBe(1)
  })

  // The browser then gives the checked radio the only tab stop and moves it with the arrows.
  it('checks the selected option only', () => {
    const html = render()
    expect(html.match(/checked=""/g)).toHaveLength(1)
    expect(html).toMatch(/checked="" value="realistic"/)
  })

  it('checks nothing for an unknown value', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl
        label="Building style"
        options={MODES}
        // A value outside the options, as a stale prop could pass.
        value={'satellite' as 'simplified'}
        onChange={() => {}}
      />,
    )
    expect(html).not.toContain('checked=""')
  })

  it('disables every option while the city is building', () => {
    const html = render(true)
    expect(html).toContain('aria-disabled="true"')
    expect(html.match(/disabled=""/g)).toHaveLength(2)
  })
})
