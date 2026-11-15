import { describe, expect, it } from 'vitest'
import { chipLabel, tailPath } from './tour-labels'

describe('tailPath', () => {
  it('cuts whole folders from the start', () => {
    expect(tailPath('src/main.ts', 32)).toBe('src/main.ts')
    expect(tailPath('src/vs/editor/common/model/textModel.ts', 32)).toBe(
      '…/common/model/textModel.ts',
    )
  })

  it('keeps a long name whole, for the line to clip', () => {
    expect(tailPath('a/multilineModelWeightsAndMoreOfThem.ts', 20)).toBe(
      '…/multilineModelWeightsAndMoreOfThem.ts',
    )
  })
})

describe('chipLabel', () => {
  it('names the root after the repository', () => {
    expect(chipLabel({ kind: 'folder', path: '/' }, 'gin')).toEqual({ text: 'gin', title: 'gin' })
  })

  it('cuts a long package name as its label does', () => {
    const name = 'github.com/grafana/grafana/pkg/apimachinery'
    expect(chipLabel({ kind: 'island', name, folders: [], count: null }, 'grafana')).toEqual({
      text: '…/pkg/apimachinery',
      title: name,
    })
  })

  it('keeps the whole path in the title', () => {
    const path = 'src/vs/editor/common/model/textModel.ts'
    expect(chipLabel({ kind: 'file', path }, 'vscode').title).toBe(path)
  })
})
