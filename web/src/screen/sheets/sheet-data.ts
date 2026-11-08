import type { FileRole, Language } from '../../ui/display/Badge'

// What the sheets and the About panel show. The city screen reads them from the analysis result
// (`app/`); the format does not carry folders' READMEs yet.

// A role inferred from the graph, with the transitive measure that grounds it:
// "Depends on 4,800 files, directly or not: most paths through the editor go through it."
export interface InferredRole {
  role: FileRole
  reason: string
}

// A file in a list, with the count that ranks it: its importers.
export interface RankedFile {
  path: string
  importers: number
}

export interface FileSymbol {
  name: string
  kind: 'class' | 'function' | 'interface' | 'type' | 'enum' | 'constant'
  line: number
}

export type CodeState =
  | { status: 'loading' }
  | { status: 'ready'; lines: readonly string[]; totalLines: number }
  // `timeout`: GitHub did not answer; `refused`: it answered with an error (rate limit, outage);
  // `gone`: the file is no longer at that commit on GitHub.
  | { status: 'error'; cause: 'timeout' | 'refused' | 'gone' }

export interface FileSheetData {
  path: string
  // Its display name, which may be a language without an analyzer ("PowerShell").
  languageName: string
  language: Language
  analyzed: boolean
  lines: number
  // For an unanalyzed file, which shows its size instead of its complexity.
  sizeBytes?: number
  complexity?: number
  complexityTop?: number
  complexityRank?: number
  repoFiles?: number
  roles: readonly InferredRole[]
  importers: number
  // All files that depend on it, directly or not.
  dependents: number
  // Set when the city groups the arcs: "Showing 20 of 1,204 importers".
  shownImporters?: number
  imports: number
  layer?: { index: number; of: number; island: string; islandPath: string }
  // One entry per cycle the file belongs to, by size.
  cycles: readonly number[]
  headerComment?: string
  importList: readonly RankedFile[]
  importerList: readonly RankedFile[]
  symbols: readonly FileSymbol[]
  code: CodeState
  githubUrl: string
}

export interface KeyFile {
  path: string
  // A likely role, or the measure that picked it.
  reason: { role: FileRole } | { mostImported: number } | { mostComplex: number }
}

export interface IslandLink {
  island: string
  islandPath: string
  direction: 'imports' | 'importedBy'
  // An import that goes up the layers.
  upward: boolean
  count: number
}

export interface FolderSheetData {
  path: string
  // "Island · layer 3 of 5", "Island" (no production code, so no layer), "Folder" (one that
  // holds islands without being one), "Tests · park".
  kind:
    | { island: { layer: number; of: number } }
    | 'island'
    | 'folder'
    | { parcel: { island: string } }
    | 'tests'
  analyzed: boolean
  files: number
  lines: number
  subFolders: number
  languages: readonly { language: Language; share: number }[]
  keyFiles: readonly KeyFile[]
  links: readonly IslandLink[]
  // The README's first paragraph as plain text, and where to read the rest.
  readme?: { text: string; url: string }
  githubUrl: string
}

export interface AboutData {
  analyzedFiles: number
  generatedFiles: number
  skipped: readonly {
    reason: 'vendored' | 'minified' | 'binary' | 'too large' | 'too deep'
    files: number
  }[]
  languages: readonly { language: Language; files: number }[]
  // Share of imports resolved to a file; absent when no language is analyzed.
  resolvedImports?: number
  unanalyzed: readonly { name: string; files: number }[]
  commit: string
  commitUrl: string
  // Where and when the analysis ran: stored beside the result, absent until the screen has it.
  branch?: string
  analyzedAt?: string
  analyzedAgo?: string
  analyzer: string
}
