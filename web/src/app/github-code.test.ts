import { afterEach, describe, expect, it, vi } from 'vitest'
import { CODE_BYTES, CODE_LINES, fetchCode, firstLines } from './github-code'

const REPO = { owner: 'acme', name: 'harbor' }
const SHA = '3f2c9a1e8b7d6c5f4a3b2c1d0e9f8a7b6c5d4e3f'

function answer(body: string | null, status = 200) {
  const fetch = vi.fn(async (_url: string) => new Response(body, { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchCode', () => {
  it('reads the file at the analyzed commit', async () => {
    const fetch = answer('one\ntwo\n')
    expect(await fetchCode(REPO, SHA, 'src/a b.ts', 2)).toEqual({
      status: 'ready',
      lines: ['one', 'two'],
      totalLines: 2,
    })
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `https://raw.githubusercontent.com/acme/harbor/${SHA}/src/a%20b.ts`,
    )
  })

  it('stops at the byte limit, its cut line dropped', async () => {
    const line = `${'x'.repeat(99)}\n`
    answer(line.repeat(CODE_BYTES / 100 + 10))
    const code = await fetchCode(REPO, SHA, 'big.ts', 2_100)
    expect(code.status === 'ready' && code.lines.length).toBe(CODE_BYTES / 100)
  })

  it('says a file gone from GitHub apart from GitHub not answering', async () => {
    answer('Not Found', 404)
    expect(await fetchCode(REPO, SHA, 'gone.ts', 1)).toEqual({ status: 'error', cause: 'gone' })
    answer('Bad gateway', 502)
    expect(await fetchCode(REPO, SHA, 'a.ts', 1)).toEqual({ status: 'error', cause: 'timeout' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('network'))),
    )
    expect(await fetchCode(REPO, SHA, 'a.ts', 1)).toEqual({ status: 'error', cause: 'timeout' })
  })

  it('gives up without a state once nobody waits', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new DOMException('aborted', 'AbortError'))),
    )
    const controller = new AbortController()
    controller.abort()
    await expect(fetchCode(REPO, SHA, 'a.ts', 1, controller.signal)).rejects.toThrow()
  })
})

describe('firstLines', () => {
  it('keeps the first lines, a last empty line or a cut one dropped', () => {
    expect(firstLines('a\r\nb\n')).toEqual(['a', 'b'])
    expect(firstLines('a\nb')).toEqual(['a', 'b'])
    expect(firstLines('a\nb', true)).toEqual(['a'])
    expect(firstLines('x\n'.repeat(CODE_LINES + 5))).toHaveLength(CODE_LINES)
  })
})
