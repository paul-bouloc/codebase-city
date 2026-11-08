import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SearchPalette, searchOptionId } from './SearchPalette'
import type { SearchResults } from './search-data'

const RESULTS: SearchResults = {
  files: {
    total: 12,
    hits: [
      {
        kind: 'file',
        path: 'src/vs/editor/common/model/textModel.ts',
        nameStart: 27,
        positions: [27, 28, 29, 30, 31, 32, 33],
        language: 'typescript',
        languageName: 'TypeScript',
        role: 'conductor',
      },
      {
        kind: 'file',
        path: 'build/lib/release.sh',
        nameStart: 10,
        positions: [],
        language: 'other',
        languageName: 'Shell',
        role: 'config',
      },
    ],
  },
  folders: {
    total: 1,
    hits: [
      {
        kind: 'folder',
        path: 'src/vs/workbench/services/textmodelResolver',
        nameStart: 26,
        positions: [26, 27],
        files: 9,
      },
    ],
  },
  symbols: {
    total: 31,
    hits: [
      {
        kind: 'symbol',
        name: 'TextModel',
        positions: [0, 1, 2, 3],
        symbolKind: 'class',
        file: 'src/vs/editor/common/model/textModel.ts',
        line: 284,
      },
    ],
  },
}

const EMPTY: SearchResults = {
  files: { total: 0, hits: [] },
  folders: { total: 0, hits: [] },
  symbols: { total: 0, hits: [] },
}

const render = (results: SearchResults, active = 0, suggestion: string | null = null) =>
  renderToStaticMarkup(
    <SearchPalette
      id="results"
      query="teminal"
      results={results}
      active={active}
      suggestion={suggestion}
      onActiveChange={() => {}}
      onChoose={() => {}}
      onSuggest={() => {}}
    />,
  )

describe('SearchPalette', () => {
  it('is a listbox of groups that say how many match', () => {
    const html = render(RESULTS)
    expect(html).toContain('id="results" role="listbox" aria-label="Search results"')
    expect(html).toContain('role="group" aria-label="Files, 12 matches"')
    expect(html).toContain('role="group" aria-label="Folders, 1 match"')
    expect(html).toContain('role="group" aria-label="Symbols, 31 matches"')
    expect(html.match(/role="option"/g)).toHaveLength(4)
  })

  it('numbers the options across groups and marks the active one', () => {
    const html = render(RESULTS, 2)
    expect(searchOptionId('results', 2)).toBe('results-option-2')
    expect(html).toMatch(/id="results-option-2" role="option" aria-selected="true"/)
    expect(html).toMatch(/id="results-option-0" role="option" aria-selected="false"/)
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1)
  })

  it('writes the folder and the name apart, the match marked', () => {
    const html = render(RESULTS)
    expect(html).toContain('title="src/vs/editor/common/model/textModel.ts"')
    expect(html).toContain('src/vs/editor/common/model/</span>')
    expect(html).toMatch(/<mark[^>]*>textMod<\/mark>el\.ts/)
  })

  it('shows a file’s language and role, an inferred role as likely', () => {
    const html = render(RESULTS)
    expect(html).toContain('TypeScript')
    expect(html).toContain('Conductor · likely')
    // A role read from the path is not inferred; a language without colour keeps its name.
    expect(html).toContain('Config<')
    expect(html).not.toContain('Config · likely')
    expect(html).toContain('Shell')
  })

  it('gives a folder its size and a symbol its kind, file and line', () => {
    const html = render(RESULTS)
    expect(html).toContain('9 files')
    expect(html).toContain('class')
    // The file, which can give way, then its line, which cannot.
    expect(html).toMatch(
      /src\/vs\/editor\/common\/model\/textModel\.ts<\/span><\/span><span[^>]*> · line 284<\/span>/,
    )
  })

  it('says when nothing matches, and offers the closest name', () => {
    const html = render(EMPTY, 0, 'terminal')
    expect(html).not.toContain('role="listbox"')
    expect(html).toContain('role="status"')
    expect(html).toContain('Nothing matches “<span')
    expect(html).toContain('>teminal</span>”.')
    expect(html).toContain('not inside the code.')
    expect(html).toMatch(/Did you mean <button[^>]*>terminal<\/button>\?/)
    expect(render(EMPTY)).not.toContain('Did you mean')
  })

  it('shows the keys in its footer', () => {
    const html = render(RESULTS)
    expect(html).toContain('move')
    expect(html).toContain('fly there')
    expect(html).toContain('close')
  })
})
