import type { ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CityTopBar } from './CityTopBar'

type Props = ComponentProps<typeof CityTopBar>

const PROPS: Props = {
  repo: {
    owner: 'microsoft',
    name: 'vscode',
    commit: 'a1b2c3d',
    analyzed: '2 days ago',
    githubUrl: 'https://github.com/microsoft/vscode/tree/a1b2c3d',
  },
  homeHref: '/',
  aboutOpen: false,
  onAboutToggle: () => {},
  searchValue: '',
  onSearchChange: () => {},
  mode: 'simplified',
  onModeChange: () => {},
  shareOpen: false,
  onShareToggle: () => {},
  account: { login: 'lena-okafor', accountHref: '/account', onSignOut: () => {} },
  onSignIn: () => {},
}

const render = (overrides: Partial<Props> = {}) =>
  renderToStaticMarkup(<CityTopBar {...PROPS} {...overrides} />)

describe('CityTopBar', () => {
  it('names the home link and the GitHub link', () => {
    const html = render()
    expect(html).toContain('aria-label="Codebase City, home"')
    expect(html).toContain(
      'aria-label="Open microsoft/vscode at a1b2c3d on GitHub (opens in a new tab)"',
    )
    expect(html).toContain('target="_blank" rel="noopener noreferrer"')
    expect(html).toContain('href="https://github.com/microsoft/vscode/tree/a1b2c3d"')
  })

  it('shows the account menu, or Sign in for a visitor, and never a quota chip', () => {
    expect(render()).toContain('aria-label="Account menu for lena-okafor"')
    expect(render()).not.toContain('Sign in')
    expect(render({ account: null })).toContain('Sign in')
    expect(render({ account: null })).not.toContain('Account menu')
  })

  // A-c14: no `aria-controls` towards a panel that is not in the page.
  it('points the About and Share buttons at their panels only when open and known', () => {
    expect(render({ aboutOpen: true })).not.toContain('aria-controls')
    const html = render({
      aboutOpen: true,
      aboutPanelId: 'about',
      shareOpen: true,
      sharePanelId: 'share',
    })
    expect(html).toContain('aria-controls="about"')
    expect(html).toContain('aria-controls="share"')
    expect(html.match(/aria-haspopup="dialog" aria-expanded="true"/g)).toHaveLength(2)
  })

  it('offers the building style unless the view has none', () => {
    expect(render()).toContain('aria-label="Building style"')
    expect(render({ showMode: false })).not.toContain('Building style')
  })

  it('disables the search until its index arrives', () => {
    expect(render()).not.toMatch(/role="combobox"[^>]*disabled=""/)
    expect(render({ searchDisabled: true })).toMatch(/role="combobox"[^>]*disabled=""/)
  })

  it('ties the mode hint to the building style', () => {
    const html = render()
    const hintId = html.match(/role="radiogroup"[^>]*aria-describedby="([^"]+)"/)?.[1]
    expect(html).toContain(`id="${hintId}" role="tooltip"`)
  })

  it('shows only the controls whose feature exists, and the repository alone', () => {
    const html = renderToStaticMarkup(
      <CityTopBar
        repo={{ ...PROPS.repo, analyzed: undefined }}
        homeHref="/"
        aboutOpen={false}
        onAboutToggle={() => {}}
      />,
    )
    expect(html).toContain('vscode')
    expect(html).not.toContain('analyzed')
    expect(html).not.toContain('role="combobox"')
    expect(html).not.toContain('Building style')
    expect(html).not.toContain('Share')
    expect(html).not.toContain('Sign in')
  })

  it('draws no GitHub link for an address that is not on github.com', () => {
    const html = render({ repo: { ...PROPS.repo, githubUrl: 'javascript:alert(1)' } })
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('on GitHub')
  })
})
