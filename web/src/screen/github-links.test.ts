import { describe, expect, it } from 'vitest'
import { githubBlobUrl, githubCommitUrl, githubTreeUrl, safeGithubHref } from './github-links'

const REPO = { owner: 'microsoft', name: 'vscode' }

describe('github links', () => {
  it('builds commit, folder and file links at a commit', () => {
    expect(githubCommitUrl(REPO, 'a1b2c3d')).toBe(
      'https://github.com/microsoft/vscode/commit/a1b2c3d',
    )
    expect(githubTreeUrl(REPO, 'a1b2c3d')).toBe('https://github.com/microsoft/vscode/tree/a1b2c3d')
    expect(githubTreeUrl(REPO, 'a1b2c3d', 'src/vs/editor')).toBe(
      'https://github.com/microsoft/vscode/tree/a1b2c3d/src/vs/editor',
    )
    expect(githubBlobUrl(REPO, 'a1b2c3d', 'src/a.ts', 284)).toBe(
      'https://github.com/microsoft/vscode/blob/a1b2c3d/src/a.ts#L284',
    )
  })

  it('keeps a path with odd characters one path', () => {
    expect(githubBlobUrl(REPO, 'a1b2c3d', 'docs/C#/notes 1?.md')).toBe(
      'https://github.com/microsoft/vscode/blob/a1b2c3d/docs/C%23/notes%201%3F.md',
    )
  })

  it('refuses a repository or a commit that is not one', () => {
    expect(() => githubTreeUrl({ owner: 'evil.com/x', name: 'y' }, 'a1b2c3d')).toThrow()
    expect(() => githubCommitUrl(REPO, 'javascript:alert(1)')).toThrow()
  })
})

describe('safeGithubHref', () => {
  it('lets through https links to github.com only', () => {
    expect(safeGithubHref('https://github.com/microsoft/vscode')).toBe(
      'https://github.com/microsoft/vscode',
    )
    expect(safeGithubHref('javascript:alert(1)')).toBeUndefined()
    expect(safeGithubHref('http://github.com/x')).toBeUndefined()
    expect(safeGithubHref('https://github.com.evil.com/x')).toBeUndefined()
    expect(safeGithubHref('not a url')).toBeUndefined()
    expect(safeGithubHref(undefined)).toBeUndefined()
  })
})
