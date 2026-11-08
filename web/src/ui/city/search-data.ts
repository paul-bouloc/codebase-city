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
