import { describe, expect, it } from 'vitest'
import type { ResultIndex } from '../../result-index'
import type { TourContext } from '../tour/tour-spans'
import { cycleList, cycleOfFile, folderName } from './cycles'
import {
  cycleFolders,
  cycleMore,
  cyclesSubtitle,
  cyclesSummary,
  showAllCycles,
} from './cycles-text'

// Folders: 0 `/` (root island, "repo"), 1 `src/vs/editor` (island "editor"), 2 its `browser`,
// 3 its `contrib/find`, 4 `src/vs/base` (island "base").
const folderPaths = [
  '/',
  'src/vs/editor',
  'src/vs/editor/browser',
  'src/vs/editor/contrib/find',
  'src/vs/base',
]

/** A city of files in these folders, with these cycles and their loops. */
function context(dirs: number[], members: number[][], shortest: number[][]): TourContext {
  const index = {
    folderPaths,
    result: {
      files: { dir: dirs },
      dirs: { island: [0, 1, 1, 1, 2] },
      islands: { dir: [0, 1, 4] },
      cycles: { members, shortest },
    },
  } as unknown as ResultIndex
  return { index, islandNames: ['repo', 'editor', 'base'], islandFiles: [0, 0, 0] }
}

describe('folderName', () => {
  const city = context([], [], [])

  it('writes a folder from the name of its island', () => {
    expect(folderName(city, 1)).toBe('editor')
    expect(folderName(city, 3)).toBe('editor/contrib/find')
  })

  it('puts the repository’s name before a folder of the root island', () => {
    expect(folderName(city, 0)).toBe('repo')
  })
})

describe('cycleList', () => {
  // Files 0–2 in browser, 3–4 in contrib/find, 5 in editor, 6–7 in base.
  const dirs = [2, 2, 2, 3, 3, 1, 4, 4]

  it('lists the biggest first, named by the two folders holding most of it', () => {
    const list = cycleList(
      context(
        dirs,
        [
          [6, 7],
          [0, 1, 3, 4, 5],
        ],
        [
          [6, 7],
          [0, 3],
        ],
      ),
    )
    expect(list.files).toBe(7)
    expect(list.cycles.map((cycle) => cycle.row)).toEqual([1, 0])
    expect(list.cycles[0]?.folders).toEqual(['editor/browser', 'editor/contrib/find'])
    expect(list.cycles[0]?.loop).toEqual([0, 3])
    expect(list.cycles[1]?.folders).toEqual(['base'])
  })

  it('orders cycles of one size by their folders', () => {
    const list = cycleList(
      context(
        dirs,
        [
          [6, 7],
          [3, 4],
        ],
        [
          [6, 7],
          [3, 4],
        ],
      ),
    )
    expect(list.cycles.map((cycle) => cycle.folders[0])).toEqual(['base', 'editor/contrib/find'])
  })

  it('finds the cycle of a file, none for a file in none', () => {
    const list = cycleList(
      context(
        dirs,
        [
          [6, 7],
          [0, 1, 3],
        ],
        [
          [6, 7],
          [0, 3],
        ],
      ),
    )
    expect(cycleOfFile(list, 1)).toBe(0)
    expect(cycleOfFile(list, 7)).toBe(1)
    expect(cycleOfFile(list, 5)).toBeNull()
  })

  it('lists nothing in a city without cycles', () => {
    expect(cycleList(context(dirs, [], []))).toEqual({ cycles: [], files: 0 })
  })
})

describe('cycles text', () => {
  it('counts the cycles under the question', () => {
    expect(cyclesSubtitle(14)).toBe('14 cycles, biggest first')
    expect(cyclesSubtitle(1)).toBe('1 cycle')
    expect(cyclesSubtitle(0)).toBe('No cycles found')
  })

  it('sums them up', () => {
    expect(cyclesSummary(136, 1_204)).toEqual({
      cycles: '136 cycles',
      rest: ' involving 1,204 files · biggest first',
    })
    expect(cyclesSummary(1, 3)).toEqual({ cycles: '1 cycle', rest: ' involving 3 files' })
  })

  it('names a cycle’s folders, says what is left of it and offers the whole list', () => {
    expect(cycleFolders(['editor/contrib/find', 'editor/browser'])).toBe(
      'editor/contrib/find ↔ editor/browser',
    )
    expect(cycleMore(21)).toBe('and 21 more · shown in the city')
    expect(showAllCycles(136)).toBe('Show all 136')
  })
})
