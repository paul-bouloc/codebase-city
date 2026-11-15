import { describe, expect, it } from 'vitest'
import { decodeResult } from '../data/decode-result'
import sample from '../data/generated/sample-result.json'
import { indexResult, pathRoleOf } from './result-index'

const index = indexResult(decodeResult(sample))
const role = (path: string) => pathRoleOf(index.result, index.fileAt(path) ?? -1)

describe('pathRoleOf', () => {
  it('reads generated code first, then tests and config from the scope', () => {
    expect(role('src/generated/schema.ts')).toBe('generated')
    expect(role('tests/store.test.ts')).toBe('test')
    expect(role('package.json')).toBe('config')
  })

  it('gives source and other scopes no path role', () => {
    expect(role('src/core/utils.ts')).toBeNull()
    expect(role('scripts/release.sh')).toBeNull()
  })
})
