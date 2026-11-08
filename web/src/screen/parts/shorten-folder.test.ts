import { describe, expect, it } from 'vitest'
import { shortenFolder, splitPath } from './shorten-folder'

const FOLDER = 'src/vs/editor/common/model/'

describe('shortenFolder', () => {
  it('keeps a folder that fits', () => {
    expect(shortenFolder(FOLDER, FOLDER.length)).toBe(FOLDER)
  })

  it('drops whole folders from the start', () => {
    expect(shortenFolder(FOLDER, 26)).toBe('…/vs/editor/common/model/')
    expect(shortenFolder(FOLDER, 15)).toBe('…/common/model/')
    expect(shortenFolder(FOLDER, 14)).toBe('…/model/')
  })

  it('falls back to the ellipsis alone', () => {
    expect(shortenFolder(FOLDER, 5)).toBe('…/')
    expect(shortenFolder(FOLDER, 0)).toBe('…/')
  })

  it('leaves the root alone', () => {
    expect(shortenFolder('', 0)).toBe('')
  })
})

describe('splitPath', () => {
  it('splits the folder from the name', () => {
    expect(splitPath('src/vs/textModel.ts')).toEqual({ folder: 'src/vs/', name: 'textModel.ts' })
    expect(splitPath('index.js')).toEqual({ folder: '', name: 'index.js' })
  })
})
