import { describe, expect, it } from 'vitest'
import { hiddenFolders } from './fit-breadcrumb'

const FOLDERS = ['src', 'vs', 'editor', 'common', 'model']
// "src / vs / editor / common / model" is 34 characters.

describe('hiddenFolders', () => {
  it('hides nothing when the path fits', () => {
    expect(hiddenFolders(FOLDERS, 34)).toBe(0)
  })

  it('drops folders from the start, behind an ellipsis', () => {
    // "… / vs / editor / common / model" is 32 characters.
    expect(hiddenFolders(FOLDERS, 33)).toBe(1)
    // "… / common / model" is 18 characters.
    expect(hiddenFolders(FOLDERS, 18)).toBe(3)
  })

  it('always keeps the last folder', () => {
    expect(hiddenFolders(FOLDERS, 3)).toBe(4)
    expect(hiddenFolders(['a-very-long-folder-name'], 5)).toBe(0)
  })

  it('has nothing to hide at the root', () => {
    expect(hiddenFolders([], 10)).toBe(0)
  })
})
