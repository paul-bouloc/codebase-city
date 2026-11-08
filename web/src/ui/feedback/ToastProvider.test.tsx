import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ToastProvider } from './ToastProvider'

describe('ToastProvider', () => {
  it('keeps a polite region mounted before the first toast', () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <main />
      </ToastProvider>,
    )
    expect(html).toContain('aria-label="Notifications" aria-live="polite"')
  })
})
