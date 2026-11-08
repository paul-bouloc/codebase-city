import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { UrlField, type UrlFieldState } from './UrlField'

const render = (state: UrlFieldState, value = 'github.com/fastapi/fastapi', showLabel = false) =>
  renderToStaticMarkup(
    <UrlField
      state={state}
      value={value}
      onChange={() => {}}
      onClear={() => {}}
      onSubmit={() => {}}
      message="Message"
      submitLabel="Build the city"
      submittingLabel="Submitting…"
      showLabel={showLabel}
    />,
  )

describe('UrlField', () => {
  it('sets up the input for pasting a URL', () => {
    const html = render('empty', '')
    expect(html).toContain('inputMode="url"')
    expect(html).toContain('autoComplete="off"')
    expect(html).toContain('spellCheck="false"')
    expect(html).toContain('placeholder="github.com/owner/repo"')
  })

  it('describes the input with the message', () => {
    const html = render('empty', '')
    const messageId = html.match(/aria-describedby="([^"]+)"/)?.[1]
    expect(html).toContain(`<p id="${messageId}"`)
  })

  it('names the input with a hidden or a visible label', () => {
    expect(render('empty', '')).toContain('aria-label="Public GitHub repository"')
    const labelled = render('empty', '', true)
    const inputId = labelled.match(/<input[^>]*id="([^"]+)"/)?.[1]
    expect(labelled).toContain(`<label for="${inputId}"`)
    expect(labelled).not.toContain('aria-label="Public GitHub repository"')
  })

  it('marks invalid and unknown repositories as errors', () => {
    for (const state of ['invalid', 'not-found'] as const) {
      expect(render(state)).toContain('aria-invalid="true"')
    }
    for (const state of ['empty', 'typing', 'valid', 'branch', 'submitting'] as const) {
      expect(render(state)).not.toContain('aria-invalid')
    }
  })

  it('keeps the same live region in every state', () => {
    for (const state of ['empty', 'valid', 'invalid', 'submitting'] as const) {
      const html = render(state)
      expect(html).toMatch(/<p [^>]*aria-live="polite" aria-atomic="true"/)
      expect(html).not.toContain('role="alert"')
    }
  })

  it('locks the field and busies the button while submitting', () => {
    const html = render('submitting')
    expect(html).toContain('readOnly=""')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('type="submit"')
  })

  it('offers to clear a value, except while typing or submitting', () => {
    expect(render('valid')).toContain('aria-label="Clear"')
    expect(render('empty', '')).not.toContain('aria-label="Clear"')
    expect(render('typing')).not.toContain('aria-label="Clear"')
    expect(render('submitting')).not.toContain('aria-label="Clear"')
  })
})
