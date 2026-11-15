import { describe, expect, it } from 'vitest'
import { decodeResult } from '../../data/decode-result'
import sample from '../../data/generated/sample-result.json'
import { guideView } from '../../guide/guide-view'
import { indexResult } from '../result-index'
import { guidePaths } from './guide-paths'

const index = indexResult(decodeResult(sample))
const steps = index.result.tour.steps

describe('guidePaths', () => {
  it('names the files and the folder of the foundations', () => {
    const step = steps.find((each) => each.kind === 'foundations')
    expect(step && guidePaths(guideView(index.result, step), index)).toEqual({
      files: ['src/core/utils.ts', 'src/core/types.ts', 'src/core/events.ts'],
      pinned: ['src/core/utils.ts', 'src/core/types.ts', 'src/core/events.ts'],
      labelled: ['src/core/utils.ts'],
      folders: ['src/core'],
      units: [],
      links: [],
      fade: 'others',
      cycle: null,
    })
  })

  it('names a file of the cycle to draw', () => {
    const step = steps.find((each) => each.kind === 'cycles')
    expect(step && guidePaths(guideView(index.result, step), index)).toMatchObject({
      cycle: 'src/core/store.ts',
      fade: 'all',
    })
  })

  it('names the folders of each unit of packages, and labels it', () => {
    const view = guideView(index.result, { kind: 'entryPoints', entries: [] })
    const unit = {
      kind: 'library' as const,
      packages: [0],
      packageKind: 'library' as const,
      group: null,
      folders: [2],
      host: null,
      framework: null,
      codeFiles: 4,
      importers: null,
    }
    const result = {
      ...index.result,
      packages: { ...index.result.packages, name: ['@harbor/core'] },
    }
    expect(guidePaths({ ...view, units: [unit] }, { ...index, result }).units).toEqual([
      { folders: ['src/core'], label: { name: '@harbor/core', caption: 'library · 4 files' } },
    ])
  })

  it('names the folders at both ends of each link, and counts it', () => {
    const view = guideView(index.result, { kind: 'entryPoints', entries: [] })
    const unit = (folders: number[]) => ({
      kind: 'app' as const,
      packages: [0],
      packageKind: 'app' as const,
      group: null,
      folders,
      host: null,
      framework: null,
      codeFiles: 4,
      importers: null,
    })
    const links = [{ from: 1, to: 0, files: 2, typeOnly: 1 }]
    expect(guidePaths({ ...view, units: [unit([2]), unit([3, 4])], links }, index).links).toEqual([
      {
        from: ['src/ui', 'src/api'],
        to: ['src/core'],
        label: { files: '2 files', typeOnly: '1 type only' },
      },
    ])
  })
})
