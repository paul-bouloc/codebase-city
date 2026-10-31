import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AccountMenu } from './AccountMenu'

describe('AccountMenu', () => {
  it('starts closed, with a trigger that names the account', () => {
    const html = renderToStaticMarkup(
      <AccountMenu login="lena-okafor" accountHref="/account" onSignOut={() => {}} />,
    )
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-label="Account menu for lena-okafor"')
    expect(html).not.toContain('role="menu"')
  })
})
