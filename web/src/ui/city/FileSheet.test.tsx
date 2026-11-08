import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FileSheet } from './FileSheet'
import type { FileSheetData } from './sheet-data'

const FILE: FileSheetData = {
  path: 'src/vs/editor/common/model/textModel.ts',
  languageName: 'TypeScript',
  language: 'typescript',
  analyzed: true,
  lines: 2481,
  complexity: 412,
  complexityTop: 1,
  complexityRank: 23,
  repoFiles: 15212,
  roles: [{ role: 'conductor', reason: 'Depends on 4,800 files, directly or not.' }],
  importers: 1204,
  dependents: 6213,
  shownImporters: 20,
  imports: 38,
  layer: { index: 3, of: 5, island: 'editor', islandPath: 'src/vs/editor' },
  cycles: [26, 4],
  importList: [{ path: 'src/vs/base/common/event.ts', importers: 4512 }],
  importerList: [{ path: 'src/vs/editor/browser/codeEditorWidget.ts', importers: 812 }],
  symbols: [{ name: 'TextModel', kind: 'class', line: 284 }],
  code: { status: 'ready', lines: ['export class TextModel {}'], totalLines: 2481 },
  githubUrl:
    'https://github.com/microsoft/vscode/blob/a1b2c3d/src/vs/editor/common/model/textModel.ts',
}

const noop = () => {}
const render = (file: FileSheetData, loading = false) =>
  renderToStaticMarkup(
    <FileSheet
      open
      file={file}
      loading={loading}
      onClose={noop}
      onOpenFolder={noop}
      onSelectFile={noop}
      onShowCycle={noop}
      onCopyPath={noop}
      onCopyLink={noop}
      onRetryCode={noop}
      onShowImpact={noop}
      onFindPath={noop}
    />,
  )

const tabLabels = (html: string) =>
  [...html.matchAll(/role="tab"[^>]*>([^<]+)/g)].map((match) => match[1])

describe('FileSheet', () => {
  it('shows the facts, one line per cycle, and the analysis actions', () => {
    const html = render(FILE)
    expect(html).toContain('6,213</strong> in total')
    expect(html).toContain('Showing 20 of 1,204 importers')
    expect(html).toContain('Part of a cycle of 26 files')
    expect(html).toContain('Part of a cycle of 4 files')
    expect(html).toContain('top 1% · rank 23 of 15,212')
    expect(html).toMatch(/<footer[^>]*>.*Show impact.*Find a path to…/)
    expect(tabLabels(html)).toEqual(['Imports', 'Imported by', 'Symbols', 'Code'])
  })

  it('keeps only the code for an unanalyzed file, with no analysis actions', () => {
    const html = render({
      ...FILE,
      analyzed: false,
      languageName: 'PowerShell',
      language: 'other',
      sizeBytes: 8400,
    })
    expect(tabLabels(html)).toEqual(['Code'])
    expect(html).toContain('PowerShell isn’t analyzed yet.')
    expect(html).toContain('Not analyzed')
    expect(html).toContain('8.4 KB')
    const tiny = render({
      ...FILE,
      analyzed: false,
      languageName: 'Batch',
      language: 'other',
      sizeBytes: 40,
    })
    expect(tiny).toContain('40 B')
    expect(html).not.toContain('<footer')
    expect(html).not.toContain('Imported by')
  })

  it('offers the analysis actions only once they exist', () => {
    const html = renderToStaticMarkup(
      <FileSheet
        open
        file={FILE}
        onClose={noop}
        onOpenFolder={noop}
        onSelectFile={noop}
        onShowCycle={noop}
        onCopyPath={noop}
        onCopyLink={noop}
        onRetryCode={noop}
      />,
    )
    expect(html).not.toContain('<footer')
    expect(html).not.toContain('Show impact')
  })

  it('leaves out the size of an unanalyzed file when it is unknown', () => {
    const html = render({ ...FILE, analyzed: false, languageName: 'JSON', language: 'other' })
    expect(html).not.toContain('Size')
    expect(html).not.toContain('—')
  })

  it('removes an empty list tab instead of greying it', () => {
    expect(tabLabels(render({ ...FILE, symbols: [] }))).toEqual(['Imports', 'Imported by', 'Code'])
  })

  it('shows the real header and a skeleton while loading', () => {
    const html = render(FILE, true)
    expect(html).toContain('textModel.ts')
    expect(html).toContain('Loading file details')
    expect(html).toContain('aria-busy="true"')
    expect(html).not.toContain('<footer')
  })

  it('falls back to the first tab there is when the asked one is gone', () => {
    const html = renderToStaticMarkup(
      <FileSheet
        open
        file={{ ...FILE, symbols: [] }}
        defaultTab="symbols"
        onClose={noop}
        onOpenFolder={noop}
        onSelectFile={noop}
        onShowCycle={noop}
        onCopyPath={noop}
        onCopyLink={noop}
        onRetryCode={noop}
        onShowImpact={noop}
        onFindPath={noop}
      />,
    )
    expect(html).toMatch(/aria-selected="true"[^>]*>Imports/)
  })
})
