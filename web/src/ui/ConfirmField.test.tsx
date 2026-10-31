import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConfirmField, confirmationMatches } from './ConfirmField'

const noop = () => {}

describe('confirmationMatches', () => {
  it('is case-sensitive and forgives surrounding spaces', () => {
    expect(confirmationMatches('lena-okafor', 'lena-okafor')).toBe(true)
    expect(confirmationMatches('  lena-okafor ', 'lena-okafor')).toBe(true)
    expect(confirmationMatches('Lena-Okafor', 'lena-okafor')).toBe(false)
    expect(confirmationMatches('lena-okafo', 'lena-okafor')).toBe(false)
  })
})

describe('ConfirmField', () => {
  it('says why the button is still blocked', () => {
    const empty = renderToStaticMarkup(
      <ConfirmField expected="lena-okafor" value="" onChange={noop} />,
    )
    expect(empty).toContain('The delete button unlocks when the login matches.')
    const typing = renderToStaticMarkup(
      <ConfirmField expected="lena-okafor" value="lena" onChange={noop} />,
    )
    expect(typing).toContain('Keep typing: it must match your login exactly.')
  })

  it('confirms a match in the same live region', () => {
    const html = renderToStaticMarkup(
      <ConfirmField expected="lena-okafor" value="lena-okafor" onChange={noop} />,
    )
    expect(html).toContain('aria-live="polite" aria-atomic="true">Login matches.</p>')
  })
})
