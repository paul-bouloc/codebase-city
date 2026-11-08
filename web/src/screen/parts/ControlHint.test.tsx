import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ControlHint } from './ControlHint'

const render = (shortcut?: string) =>
  renderToStaticMarkup(
    <ControlHint text="Recenter" shortcut={shortcut} side="left">
      {(hintId) => (
        <button type="button" aria-describedby={hintId}>
          R
        </button>
      )}
    </ControlHint>,
  )

describe('ControlHint', () => {
  it('describes the control with a real tooltip element', () => {
    const html = render('F')
    const describedBy = html.match(/aria-describedby="([^"]+)"/)?.[1]
    expect(describedBy).toBeDefined()
    expect(html).toContain(`id="${describedBy}" role="tooltip"`)
  })

  it('names the shortcut in a key', () => {
    expect(render('F')).toMatch(/<kbd [^>]*>F<\/kbd>/)
    expect(render()).not.toContain('<kbd')
  })

  it('stays visual when it only repeats the control', () => {
    const html = renderToStaticMarkup(
      <ControlHint text="Zoom in" shortcut="+" describes={false}>
        {(hintId) => (
          <button type="button" aria-describedby={hintId}>
            +
          </button>
        )}
      </ControlHint>,
    )
    expect(html).not.toContain('aria-describedby')
    expect(html).not.toContain('role="tooltip"')
    expect(html).toContain('aria-hidden="true"')
  })
})
