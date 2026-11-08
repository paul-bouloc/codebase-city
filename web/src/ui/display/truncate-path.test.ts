import { describe, expect, it } from 'vitest'
import { truncatePath } from './truncate-path'

const LONG = 'src/vs/workbench/contrib/terminal/browser/terminalInstance.ts'

describe('truncatePath', () => {
  it('leaves a path that fits untouched', () => {
    expect(truncatePath(LONG, LONG.length)).toBe(LONG)
    expect(truncatePath('index.js', 3)).toBe('index.js')
  })

  it('keeps the first two folders and the last one', () => {
    expect(truncatePath(LONG, 40)).toBe('src/vs/…/browser/terminalInstance.ts')
  })

  it('drops the last folder before touching the name', () => {
    expect(truncatePath(LONG, 30)).toBe('src/vs/…/terminalInstance.ts')
  })

  it('then drops the leading folders', () => {
    expect(truncatePath(LONG, 26)).toBe('src/…/terminalInstance.ts')
    expect(truncatePath(LONG, 22)).toBe('…/terminalInstance.ts')
  })

  it('never cuts the file name', () => {
    expect(truncatePath(LONG, 5)).toBe('…/terminalInstance.ts')
    expect(truncatePath('aVeryLongFileNameWithoutFolders.ts', 10)).toBe(
      'aVeryLongFileNameWithoutFolders.ts',
    )
  })

  it('only elides when it saves something', () => {
    // Three folders: "a/b/…/c/name" would be longer than the path itself.
    expect(truncatePath('lib/router/layer/index.js', 22)).toBe('lib/router/…/index.js')
    expect(truncatePath('lib/router/index.js', 15)).toBe('lib/…/index.js')
  })
})
