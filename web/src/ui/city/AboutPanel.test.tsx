import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AboutPanel, type NewerVersion } from './AboutPanel'
import type { AboutData } from './sheet-data'

const ABOUT: AboutData = {
  analyzedFiles: 15212,
  generatedFiles: 412,
  skipped: [
    { reason: 'vendored', files: 1650 },
    { reason: 'minified', files: 2100 },
    { reason: 'binary', files: 140 },
    { reason: 'too large', files: 14 },
  ],
  languages: [
    { language: 'other', files: 197 },
    { language: 'typescript', files: 14330 },
  ],
  resolvedImports: 0.92,
  unanalyzed: [{ name: 'C', files: 312 }],
  commit: 'a1b2c3d',
  commitUrl: 'https://github.com/microsoft/vscode/commit/a1b2c3d',
  branch: 'main',
  analyzedAt: 'Oct 27, 2026, 9:14 AM',
  analyzedAgo: '2 days ago',
  analyzer: 'cc-analyzer 0.9.3',
}

const noop = () => {}
const render = (about: AboutData, newer?: NewerVersion, open = true) =>
  renderToStaticMarkup(
    <AboutPanel id="about" open={open} about={about} newer={newer} onClose={noop} />,
  )

describe('AboutPanel', () => {
  it('is a dialog named by its title, always in the page, inert while closed', () => {
    const html = render(ABOUT)
    const titleId = html.match(/<h2 [^>]*id="([^"]+)"/)?.[1]
    expect(html).toMatch(/^<div [^>]*id="about" role="dialog"/)
    expect(html).toMatch(new RegExp(`^<div [^>]*aria-labelledby="${titleId}"`))
    expect(html).toContain('About this repository')
    expect(render(ABOUT, undefined, false)).toMatch(/^<div [^>]*inert=""/)
  })

  it('counts generated files apart, never among the skipped ones', () => {
    const html = render(ABOUT)
    expect(html).toContain('3,904')
    expect(html).toContain('Why 3,904 were skipped')
    expect(html).toContain('412 generated files, shown but left out of the tour')
    expect(html).not.toMatch(/<dt>generated<\/dt>/)
  })

  it('lists languages by size with unanalyzed files last', () => {
    const html = render(ABOUT)
    expect(html.indexOf('TypeScript')).toBeLessThan(html.indexOf('Other'))
  })

  it('says how imports were resolved, or that there are no flows at all', () => {
    expect(render(ABOUT)).toContain('92%</strong> of imports resolved to a file')
    expect(render(ABOUT)).toContain('312 C files</strong> shown without dependencies')
    expect(render({ ...ABOUT, resolvedImports: undefined })).toContain('the city draws no flows')
  })

  it('leaves out when and on which branch it ran until the screen knows', () => {
    const { branch, analyzedAt, analyzedAgo, ...rest } = ABOUT
    const html = render(rest)
    expect(html).not.toContain('Analyzed<')
    expect(html).not.toContain(' · main')
    expect(html).not.toContain('2 days ago')
    expect(html).toContain('a1b2c3d')
  })

  it('offers to rebuild when a newer version exists, or to sign in first', () => {
    const newer: NewerVersion = {
      commits: 48,
      signedIn: true,
      quotaNote: 'Rebuilding uses 1 analysis · 7 left today.',
      onRebuild: noop,
      onSignIn: noop,
    }
    expect(render(ABOUT)).not.toContain('Rebuild')
    expect(render(ABOUT, newer)).toContain('The repository has 48 new commits.')
    expect(render(ABOUT, newer)).toContain('Rebuild with the latest commit')
    const out = render(ABOUT, { ...newer, signedIn: false, commits: null })
    expect(out).toContain('The repository has changed since.')
    expect(out).toContain('Sign in with GitHub to rebuild')
  })

  it('speaks of one file in the singular and never rounds to 100%', () => {
    const html = render({
      ...ABOUT,
      analyzedFiles: 1,
      skipped: [{ reason: 'binary', files: 1 }],
      resolvedImports: 0.996,
    })
    expect(html).toContain('file analyzed')
    expect(html).toContain('file skipped')
    expect(html).toContain('Why 1 was skipped')
    expect(html).toContain('&gt;99%</strong> of imports resolved')
  })
})
