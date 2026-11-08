import { describe, expect, it } from 'vitest'
import { decodeResult } from '../data/decode-result'
import type { AnalysisResult } from '../data/generated/AnalysisResult'
import sample from '../data/generated/sample-result.json'
import { folderSheetData } from './folder-sheet'
import { indexResult } from './result-index'

const index = indexResult(decodeResult(sample))

/** The sample with more imports, as the edges table orders them. */
function withEdges(
  extra: { from: number; to: number | null; toDir?: number; kind?: 'import' | 'reexport' }[],
) {
  const json = structuredClone(sample) as unknown as AnalysisResult
  for (const edge of extra) {
    json.edges.from.push(edge.from)
    json.edges.to.push(edge.to)
    json.edges.toDir.push(edge.toDir ?? null)
    json.edges.kind.push(edge.kind ?? 'import')
    json.edges.confidence.push('exact')
  }
  return indexResult(json)
}

describe('folderSheetData', () => {
  it('reads an island: its layer, files, languages, key files and links', () => {
    expect(folderSheetData(index, 'src/core')).toEqual({
      path: 'src/core',
      kind: { island: { layer: 1, of: 3 } },
      analyzed: true,
      files: 5,
      lines: 712,
      subFolders: 0,
      languages: [{ language: 'typescript', share: 1 }],
      // Its foundations, the strongest first; the most imported and most complex are among them.
      keyFiles: [
        { path: 'src/core/utils.ts', reason: { role: 'foundation' } },
        { path: 'src/core/types.ts', reason: { role: 'foundation' } },
        { path: 'src/core/events.ts', reason: { role: 'foundation' } },
        { path: 'src/core/store.ts', reason: { role: 'foundation' } },
      ],
      links: [
        { island: 'ui', islandPath: 'src/ui', direction: 'importedBy', upward: false, count: 3 },
        { island: 'api', islandPath: 'src/api', direction: 'importedBy', upward: false, count: 2 },
        { island: 'src', islandPath: 'src', direction: 'importedBy', upward: false, count: 1 },
        { island: 'tests', islandPath: 'tests', direction: 'importedBy', upward: false, count: 1 },
      ],
      githubUrl:
        'https://github.com/acme/harbor/tree/3f2c9a1e8b7d6c5f4a3b2c1d0e9f8a7b6c5d4e3f/src/core',
    })
  })

  it('counts a folder split into islands by its own files', () => {
    const src = folderSheetData(index, 'src')
    expect(src).toMatchObject({ files: 2, subFolders: 0, kind: { island: { layer: 3, of: 3 } } })
    expect(src?.links).toEqual([
      { island: 'api', islandPath: 'src/api', direction: 'imports', upward: false, count: 1 },
      { island: 'core', islandPath: 'src/core', direction: 'imports', upward: false, count: 1 },
      { island: 'ui', islandPath: 'src/ui', direction: 'imports', upward: false, count: 1 },
    ])
  })

  it('lists imports up the layers last and apart, a facade’s re-exports never among them', () => {
    // `utils.ts` (core, layer 1) imports `view.ts` (ui, layer 2); the barrel re-exports `button.ts`
    const core = folderSheetData(
      withEdges([
        { from: 8, to: 9 },
        { from: 4, to: 10, kind: 'reexport' },
      ]),
      'src/core',
    )
    expect(core?.links.filter((link) => link.direction === 'imports')).toEqual([
      { island: 'ui', islandPath: 'src/ui', direction: 'imports', upward: false, count: 1 },
      { island: 'ui', islandPath: 'src/ui', direction: 'imports', upward: true, count: 1 },
    ])
    expect(core?.links.at(-1)?.upward).toBe(true)
  })

  it('counts an import of a package for the folder that holds it', () => {
    // `main.ts` imports the folder `src/core` as a package, as Go does
    const core = folderSheetData(withEdges([{ from: 2, to: null, toDir: 2 }]), 'src/core')
    expect(core?.links).toContainEqual({
      island: 'src',
      islandPath: 'src',
      direction: 'importedBy',
      upward: false,
      count: 2,
    })
  })

  it('names a test park, an island without production code and an unread folder', () => {
    expect(folderSheetData(index, 'tests')?.kind).toBe('tests')
    expect(folderSheetData(index, 'src/generated')?.kind).toBe('island')
    expect(folderSheetData(index, '/')).toMatchObject({
      kind: 'island',
      analyzed: false,
      files: 2,
      languages: [{ language: 'other', share: 1 }],
      keyFiles: [],
      links: [],
      githubUrl: 'https://github.com/acme/harbor/tree/3f2c9a1e8b7d6c5f4a3b2c1d0e9f8a7b6c5d4e3f',
    })
  })

  it('reads a folder that holds islands, links between them left out', () => {
    // `src/pkg` holds the islands `core` and `ui`, moved into it
    const json = structuredClone(sample) as unknown as AnalysisResult
    json.dirs.parent.push(1, 8, 8)
    json.dirs.name.push('pkg', 'core', 'ui')
    json.dirs.island.push(null, 2, 3)
    json.islands.dir[2] = 9
    json.islands.dir[3] = 10
    json.files.dir = json.files.dir.map((dir) => (dir === 2 ? 9 : dir === 3 ? 10 : dir))
    const pkg = folderSheetData(indexResult(json), 'src/pkg')
    expect(pkg).toMatchObject({ kind: 'folder', files: 10, subFolders: 2 })
    expect(pkg?.links).toEqual([
      { island: 'api', islandPath: 'src/api', direction: 'importedBy', upward: false, count: 2 },
      { island: 'src', islandPath: 'src', direction: 'importedBy', upward: false, count: 2 },
      { island: 'tests', islandPath: 'tests', direction: 'importedBy', upward: false, count: 2 },
    ])
  })

  it('reads a parcel by its subtree, on its island', () => {
    // `utils.ts` moved to `src/core/sub`, a folder inside the `core` island
    const json = structuredClone(sample) as unknown as AnalysisResult
    json.dirs.parent.push(2)
    json.dirs.name.push('sub')
    json.dirs.island.push(2)
    json.files.dir[8] = 8
    const moved = indexResult(json)
    expect(folderSheetData(moved, 'src/core/sub')).toMatchObject({
      kind: { parcel: { island: 'core' } },
      files: 1,
      lines: 120,
    })
    expect(folderSheetData(moved, 'src/core')).toMatchObject({ files: 5, subFolders: 1 })
  })
})
