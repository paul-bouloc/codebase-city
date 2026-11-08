import { describe, expect, it } from 'vitest'
import { hashOf, selectionOfHash } from './selection-hash'

describe('selection in the fragment', () => {
  it('writes a file or a folder, its slashes readable', () => {
    expect(hashOf({ kind: 'file', path: 'src/app.ts' })).toBe('#file=src/app.ts')
    expect(hashOf({ kind: 'dir', path: 'src/core' })).toBe('#dir=src/core')
    expect(hashOf(null)).toBe('')
  })

  it('reads back what it writes, odd characters included', () => {
    for (const path of ['src/a b#c?.ts', 'docs/100%.md', 'é/ü.ts', '/']) {
      expect(selectionOfHash(hashOf({ kind: 'file', path }))).toEqual({ kind: 'file', path })
    }
  })

  it('names nothing for any other fragment', () => {
    expect(selectionOfHash('')).toBeNull()
    expect(selectionOfHash('#top')).toBeNull()
    expect(selectionOfHash('#file=')).toBeNull()
    expect(selectionOfHash('#file=%E0')).toBeNull()
  })
})
