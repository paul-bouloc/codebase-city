import type { AboutData, FileSheetData, FolderSheetData } from '../src/ui/city/sheet-data'

// The boards' demonstration content: microsoft/vscode at a1b2c3d. Counts are made up but kept
// consistent with one another, and lists are sorted by importance (the boards' were not, A-c16).

const BLOB = 'https://github.com/microsoft/vscode/blob/a1b2c3d'
const TREE = 'https://github.com/microsoft/vscode/tree/a1b2c3d'

const HEADER_COMMENT = `/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The text model holds the content of one editor buffer.
 *
 * It owns the piece tree, tracks versions for undo and redo, emits
 * content change events, and keeps decorations and tokens in step
 * with every edit. Views never touch the buffer directly: they go
 * through this model, which validates positions and ranges.
 *
 * Large files are loaded in chunks; see \`createTextBuffer\`.
 * Line endings are normalised on load and kept per model.
 */`

const IMPORTS: [string, number][] = [
  ['src/vs/base/common/event.ts', 4512],
  ['src/vs/base/common/lifecycle.ts', 4380],
  ['src/vs/editor/common/core/range.ts', 2950],
  ['src/vs/editor/common/core/position.ts', 2710],
  ['src/vs/base/common/uri.ts', 2604],
  ['src/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBuffer.ts', 1260],
  ['src/vs/editor/common/tokens/tokens.ts', 940],
  ['src/vs/platform/instantiation/common/instantiation.ts', 880],
  ...Array.from({ length: 30 }, (_, index): [string, number] => [
    `src/vs/editor/common/model/helper${index + 1}.ts`,
    600 - index * 19,
  ]),
]

const IMPORTERS: [string, number][] = [
  ['src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts', 812],
  ['src/vs/editor/common/services/modelService.ts', 640],
  [
    'src/vs/workbench/contrib/extensions/browser/extensionRecommendationsService.contribution.ts',
    410,
  ],
  ['src/vs/editor/common/viewModel/viewModelImpl.ts', 388],
  ['src/vs/workbench/services/textfile/common/textFileEditorModel.ts', 351],
  ['src/vs/editor/contrib/find/browser/findModel.ts', 207],
  ['src/vs/editor/standalone/browser/standaloneEditor.ts', 160],
  ['src/vs/editor/common/model/textModelSearch.ts', 120],
  ...Array.from({ length: 52 }, (_, index): [string, number] => [
    `src/vs/workbench/contrib/part${index + 1}/browser/view.ts`,
    100 - index,
  ]),
]

const CODE_LINES = [
  "import { Emitter, Event } from 'vs/base/common/event';",
  "import { Disposable } from 'vs/base/common/lifecycle';",
  "import { Range } from 'vs/editor/common/core/range';",
  '',
  'export class TextModel extends Disposable implements model.ITextModel {',
  '\tprivate readonly _onDidChangeContent = this._register(new Emitter<IModelContentChangedEvent>());',
  '\tpublic readonly onDidChangeContent: Event<IModelContentChangedEvent> = this._onDidChangeContent.event;',
  '',
  '\tconstructor(source: string | model.ITextBufferFactory, languageId: string) {',
  '\t\tsuper();',
  '\t}',
  '}',
]

export const FILE: FileSheetData = {
  path: 'src/vs/editor/common/model/textModel.ts',
  languageName: 'TypeScript',
  language: 'typescript',
  analyzed: true,
  lines: 2481,
  complexity: 412,
  complexityTop: 1,
  complexityRank: 23,
  repoFiles: 15212,
  roles: [
    {
      role: 'conductor',
      reason:
        'Depends on 4,800 files, directly or not: most paths through the editor go through it.',
    },
  ],
  importers: 1204,
  dependents: 6213,
  shownImporters: 20,
  imports: IMPORTS.length,
  layer: { index: 3, of: 5, island: 'editor', islandPath: 'src/vs/editor' },
  cycles: [26],
  headerComment: HEADER_COMMENT,
  importList: IMPORTS.map(([path, importers]) => ({ path, importers })),
  importerList: IMPORTERS.map(([path, importers]) => ({ path, importers })),
  symbols: [
    { name: 'TextModel', kind: 'class', line: 284 },
    { name: 'TextModelSnapshot', kind: 'class', line: 196 },
    { name: 'createTextBuffer', kind: 'function', line: 112 },
    { name: 'createTextBufferFactory', kind: 'function', line: 140 },
    { name: 'indentOfLine', kind: 'function', line: 2196 },
    { name: 'ITextModelCreationOptions', kind: 'interface', line: 64 },
    { name: 'TextModelResolvedOptions', kind: 'type', line: 88 },
    { name: 'EndOfLinePreference', kind: 'enum', line: 40 },
    ...Array.from({ length: 88 }, (_, index) => ({
      name: `exportedHelper${index + 1}`,
      kind: 'function' as const,
      line: 2200 + index * 3,
    })),
  ],
  code: { status: 'ready', lines: CODE_LINES, totalLines: 2481 },
  githubUrl: `${BLOB}/src/vs/editor/common/model/textModel.ts`,
}

// A file in several cycles: one line each (A11).
export const FILE_CYCLES: FileSheetData = { ...FILE, cycles: [26, 7, 3] }

export const FILE_CODE_TIMEOUT: FileSheetData = {
  ...FILE,
  code: { status: 'error', cause: 'timeout' },
}
export const FILE_CODE_GONE: FileSheetData = { ...FILE, code: { status: 'error', cause: 'gone' } }

export const UNANALYZED_FILE: FileSheetData = {
  path: 'src/vs/workbench/contrib/terminal/common/scripts/shellIntegration.ps1',
  languageName: 'PowerShell',
  language: 'other',
  analyzed: false,
  lines: 212,
  sizeBytes: 8400,
  roles: [],
  importers: 0,
  dependents: 0,
  imports: 0,
  cycles: [],
  importList: [],
  importerList: [],
  symbols: [],
  code: {
    status: 'ready',
    lines: [
      '# ---------------------------------------------------------------------------------------------',
      '#   Copyright (c) Microsoft Corporation. All rights reserved.',
      '# ---------------------------------------------------------------------------------------------',
      '',
      '# Prevent installing more than once per session',
      'if (Test-Path variable:global:__VSCodeOriginalPrompt) {',
      '\treturn;',
      '}',
    ],
    totalLines: 8,
  },
  githubUrl: `${BLOB}/src/vs/workbench/contrib/terminal/common/scripts/shellIntegration.ps1`,
}

export const FOLDER: FolderSheetData = {
  path: 'src/vs/editor',
  kind: { island: { layer: 3, of: 5 } },
  analyzed: true,
  files: 3140,
  lines: 612_400,
  subFolders: 5,
  languages: [
    { language: 'typescript', share: 0.96 },
    { language: 'css', share: 0.03 },
    { language: 'javascript', share: 0.004 },
    { language: 'other', share: 0.003 },
  ],
  keyFiles: [
    { path: 'src/vs/editor/browser/editorExtensions.ts', reason: { role: 'conductor' } },
    { path: 'src/vs/editor/standalone/browser/editor.api.ts', reason: { role: 'entry-point' } },
    {
      path: 'src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts',
      reason: { mostImported: 812 },
    },
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
    {
      island: 'platform',
      islandPath: 'src/vs/platform',
      direction: 'imports',
      upward: false,
      count: 1730,
    },
    {
      island: 'workbench',
      islandPath: 'src/vs/workbench',
      direction: 'importedBy',
      upward: false,
      count: 2950,
    },
    {
      island: 'code',
      islandPath: 'src/vs/code',
      direction: 'importedBy',
      upward: false,
      count: 160,
    },
  ],
  readme: {
    text: 'Monaco is the code editor that powers VS Code. This folder holds its model, its view and its contributions: everything that turns a text buffer into an editor, from tokenization and decorations to find, folding and suggestions. It has no dependency on the workbench and ships on its own as the Monaco Editor package.',
    url: `${TREE}/src/vs/editor#readme`,
  },
  githubUrl: `${TREE}/src/vs/editor`,
}

export const FOLDER_NO_README: FolderSheetData = { ...FOLDER, readme: undefined }

export const UNANALYZED_FOLDER: FolderSheetData = {
  path: 'src/vs/workbench/contrib/terminal/common/scripts',
  kind: { parcel: { island: 'workbench' } },
  analyzed: false,
  files: 9,
  lines: 1_840,
  subFolders: 0,
  languages: [{ language: 'other', share: 1 }],
  keyFiles: [],
  links: [],
  githubUrl: `${TREE}/src/vs/workbench/contrib/terminal/common/scripts`,
}

export const TEST_PARK: FolderSheetData = {
  ...FOLDER,
  path: 'src/vs/editor/test',
  kind: 'tests',
  files: 412,
  lines: 98_200,
  subFolders: 3,
  languages: [{ language: 'typescript', share: 1 }],
  keyFiles: [],
  readme: undefined,
  githubUrl: `${TREE}/src/vs/editor/test`,
}

export const ABOUT: AboutData = {
  analyzedFiles: 15_212,
  generatedFiles: 412,
  skipped: [
    { reason: 'vendored', files: 1_650 },
    { reason: 'minified', files: 2_100 },
    { reason: 'binary', files: 140 },
    { reason: 'too large', files: 14 },
  ],
  languages: [
    { language: 'typescript', files: 14_330 },
    { language: 'javascript', files: 396 },
    { language: 'css', files: 289 },
    { language: 'other', files: 197 },
  ],
  resolvedImports: 0.92,
  unanalyzed: [{ name: 'C', files: 312 }],
  commit: 'a1b2c3d',
  commitUrl: 'https://github.com/microsoft/vscode/commit/a1b2c3d',
  branch: 'main',
  analyzedAt: 'Oct 27, 2026, 9:14 AM',
  analyzedAgo: '2 days ago',
  analyzer: 'cc-analyzer 0.9.3',
}

// A repository in a language without an analyzer (A17).
export const ABOUT_NO_FLOWS: AboutData = {
  ...ABOUT,
  analyzedFiles: 1_204,
  generatedFiles: 0,
  languages: [{ language: 'other', files: 1_204 }],
  resolvedImports: undefined,
  unanalyzed: [{ name: 'Go', files: 1_204 }],
}
