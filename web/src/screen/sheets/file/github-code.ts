import type { GithubRepo } from '../../github-links'
import { githubRawUrl } from '../../github-links'
import type { CodeState } from '../sheet-data'

// A file's code, read from GitHub when its sheet shows it, never stored.

/** The sheet shows the start of a file: this many lines, */
export const CODE_LINES = 2_000
/** or this many bytes, whichever comes first. */
export const CODE_BYTES = 200_000
/** GitHub that has not answered by then is not going to. */
const TIMEOUT_MS = 10_000

/** Reads the start of a file at a commit; `totalLines` is the whole file's, from the analysis. */
export async function fetchCode(
  repo: GithubRepo,
  sha: string,
  path: string,
  totalLines: number,
  signal?: AbortSignal,
): Promise<CodeState> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  try {
    const response = await fetch(githubRawUrl(repo, sha, path), {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (response.status === 404) {
      return { status: 'error', cause: 'gone' }
    }
    // A rate limit or an outage: GitHub answered, but not with the file.
    if (!response.ok || !response.body) {
      return { status: 'error', cause: 'refused' }
    }
    const { text, cut } = await readStart(response.body, CODE_BYTES)
    return { status: 'ready', lines: firstLines(text, cut), totalLines }
  } catch (error) {
    // The reader gone, nobody waits for the code.
    if (signal?.aborted) {
      throw error
    }
    return { status: 'error', cause: 'timeout' }
  }
}

/** The text of the first `limit` bytes of a body, without reading further, and if it went on. */
async function readStart(
  body: ReadableStream<Uint8Array>,
  limit: number,
): Promise<{ text: string; cut: boolean }> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    // One byte past the limit says the file goes on.
    while (size <= limit) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      chunks.push(value)
      size += value.length
    }
  } finally {
    void reader.cancel()
  }
  const bytes = new Uint8Array(Math.min(size, limit))
  let at = 0
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes.length - at)
    bytes.set(part, at)
    at += part.length
  }
  return { text: new TextDecoder().decode(bytes), cut: size > limit }
}

/**
 * The file's first lines. When the bytes ran out before the file's end, its last line is cut
 * (a character maybe in two): it is dropped.
 */
export function firstLines(text: string, cut = false): string[] {
  const lines = text.split(/\r?\n/)
  if (cut || (lines.length > 1 && lines.at(-1) === '')) {
    lines.pop()
  }
  return lines.slice(0, CODE_LINES)
}
