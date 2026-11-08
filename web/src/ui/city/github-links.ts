// Links to GitHub, built from the parts of the analysis and never taken whole from repository
// content: a path with `#`, `?`, `%` or a space stays one path, and nothing but github.com gets
// through.

const GITHUB = 'https://github.com'
const NAME = /^[A-Za-z0-9._-]+$/
const SHA = /^[0-9a-f]{4,40}$/i

export interface GithubRepo {
  owner: string
  name: string
}

function repoBase({ owner, name }: GithubRepo): string {
  if (!NAME.test(owner) || !NAME.test(name)) {
    throw new Error(`Not a GitHub repository: ${owner}/${name}`)
  }
  return `${GITHUB}/${owner}/${name}`
}

function checkedSha(sha: string): string {
  if (!SHA.test(sha)) {
    throw new Error(`Not a commit hash: ${sha}`)
  }
  return sha
}

// Each segment encoded on its own, so the slashes stay separators.
function encodedPath(path: string): string {
  return path.split('/').filter(Boolean).map(encodeURIComponent).join('/')
}

export function githubCommitUrl(repo: GithubRepo, sha: string): string {
  return `${repoBase(repo)}/commit/${checkedSha(sha)}`
}

// A folder (or the repository root, for an empty path) at a commit.
export function githubTreeUrl(repo: GithubRepo, sha: string, path = ''): string {
  const base = `${repoBase(repo)}/tree/${checkedSha(sha)}`
  return path ? `${base}/${encodedPath(path)}` : base
}

// A file at a commit, at a line if one is given.
export function githubBlobUrl(repo: GithubRepo, sha: string, path: string, line?: number): string {
  const url = `${repoBase(repo)}/blob/${checkedSha(sha)}/${encodedPath(path)}`
  return line === undefined ? url : `${url}#L${Math.trunc(line)}`
}

// The last guard where a link is drawn: anything that is not an https link to github.com is
// dropped (no link at all rather than a wrong one).
export function safeGithubHref(url: string | undefined): string | undefined {
  if (!url) {
    return undefined
  }
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com'
      ? parsed.href
      : undefined
  } catch {
    return undefined
  }
}

// A file's raw content at a commit, as the browser may read it (raw.githubusercontent.com allows
// any origin).
export function githubRawUrl(repo: GithubRepo, sha: string, path: string): string {
  repoBase(repo)
  return `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${checkedSha(sha)}/${encodedPath(path)}`
}
