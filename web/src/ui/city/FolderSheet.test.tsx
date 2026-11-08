import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FolderSheet } from './FolderSheet'
import { orderedLinks } from './island-links'
import type { FolderSheetData } from './sheet-data'

const FOLDER: FolderSheetData = {
  path: 'src/vs/editor',
  kind: { island: { layer: 3, of: 5 } },
  analyzed: true,
  files: 3140,
  lines: 612_000,
  subFolders: 5,
  languages: [
    { language: 'typescript', share: 0.96 },
    { language: 'css', share: 0.03 },
  ],
  keyFiles: [
    { path: 'src/vs/editor/browser/editorExtensions.ts', reason: { role: 'conductor' } },
    { path: 'src/vs/editor/common/model/textModel.ts', reason: { mostComplex: 412 } },
  ],
  links: [
    {
      island: 'workbench',
      islandPath: 'src/vs/workbench',
      direction: 'imports',
      upward: true,
      count: 3,
    },
    { island: 'base', islandPath: 'src/vs/base', direction: 'imports', upward: false, count: 2214 },
  ],
  readme: { text: 'The editor of VS Code.', url: 'https://github.com/x#readme' },
  githubUrl: 'https://github.com/microsoft/vscode/tree/a1b2c3d/src/vs/editor',
}

const noop = () => {}
const render = (folder: FolderSheetData) =>
  renderToStaticMarkup(
    <FolderSheet
      open
      folder={folder}
      onClose={noop}
      onOpenFolder={noop}
      onSelectFile={noop}
      onCopyLink={noop}
    />,
  )

describe('FolderSheet', () => {
  it('names the island and its layer, with no analysis actions or path to copy', () => {
    const html = render(FOLDER)
    expect(html).toContain('editor/')
    expect(html).toContain('Island · layer 3 of 5')
    expect(html).toContain('612k')
    expect(html).not.toContain('<footer')
    expect(html).not.toContain('Copy path')
    expect(html).not.toContain('Show impact')
  })

  it('writes key files from the folder, with their reason', () => {
    const html = render(FOLDER)
    expect(html).toContain('>browser/<')
    expect(html).toContain('Conductor · likely')
    expect(html).toContain('most complex here · 412')
  })

  it('leaves the README out when there is none', () => {
    expect(render(FOLDER)).toContain('From its README')
    const html = render({ ...FOLDER, readme: undefined })
    expect(html).not.toContain('README')
  })

  it('lists upward imports last', () => {
    expect(orderedLinks(FOLDER.links).map(({ island }) => island)).toEqual(['base', 'workbench'])
  })

  it('says when a folder is the test park', () => {
    expect(render({ ...FOLDER, kind: 'tests' })).toContain('Tests · park')
  })

  it('names an island without production code without a layer', () => {
    const html = render({ ...FOLDER, kind: 'island' })
    expect(html).toContain('>Island<')
    expect(html).not.toContain('layer')
  })

  it('opens GitHub in a new tab and drops a README link that is not on github.com', () => {
    expect(render(FOLDER)).toContain('target="_blank"')
    const html = render({ ...FOLDER, readme: { text: 'Hi', url: 'https://evil.example/x' } })
    expect(html).toContain('Hi')
    expect(html).not.toContain('evil.example')
  })
})
