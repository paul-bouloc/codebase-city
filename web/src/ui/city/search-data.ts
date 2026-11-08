import type { FileRole, Language } from '../Badge'
import type { FileSymbol } from './sheet-data'

// What the search palette shows. The city screen finds it in the analysis result (`app/`).

/** A file found by the search. */
export interface FileHit {
  kind: 'file'
  path: string
  /** Where the name starts in the path. */
  nameStart: number
  /** The matched characters' indices in the path. */
  positions: number[]
  language: Language
  /** The language's own name, for one the interface has no colour for. */
  languageName: string
  /** The strongest role the graph gives it, else what the path says it is. */
  role: FileRole | null
}

/** A folder found by the search. */
export interface FolderHit {
  kind: 'folder'
  path: string
  nameStart: number
  positions: number[]
  /** Files in it, at any depth. */
  files: number
}

/** An exported symbol found by the search. */
export interface SymbolHit {
  kind: 'symbol'
  name: string
  /** The matched characters' indices in the name. */
  positions: number[]
  symbolKind: FileSymbol['kind']
  /** The file that exports it. */
  file: string
  line: number
}

export type SearchHit = FileHit | FolderHit | SymbolHit

export interface SearchGroup<Hit> {
  /** How many match in all. */
  total: number
  /** The best of them, the best first. */
  hits: Hit[]
}

export interface SearchResults {
  files: SearchGroup<FileHit>
  folders: SearchGroup<FolderHit>
  symbols: SearchGroup<SymbolHit>
}

/** The palette's options in their order: files, then folders, then symbols. */
export function searchOptions(results: SearchResults): SearchHit[] {
  return [...results.files.hits, ...results.folders.hits, ...results.symbols.hits]
}

/** A run of text, matched by the query or not. */
export interface TextRun {
  text: string
  match: boolean
}

/**
 * Cuts `text[from, to)` into runs, the characters at `positions` (indices in the whole text)
 * marked as matched.
 */
export function highlightRuns(
  text: string,
  positions: readonly number[],
  from = 0,
  to = text.length,
): TextRun[] {
  const matched = new Set(positions)
  const runs: TextRun[] = []
  for (let index = from; index < to; index++) {
    const match = matched.has(index)
    const last = runs.at(-1)
    if (last && last.match === match) {
      last.text += text[index]
    } else {
      runs.push({ text: text[index] ?? '', match })
    }
  }
  return runs
}
