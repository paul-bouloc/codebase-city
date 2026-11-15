// What the interface tells files apart by: the languages it colours and the roles it names.

export type Language = 'typescript' | 'javascript' | 'python' | 'go' | 'css' | 'other'

export type FileRole =
  | 'entry-point'
  | 'foundation'
  | 'conductor'
  | 'facade'
  | 'test'
  | 'config'
  | 'generated'

/** The roles a file's path tells, rather than the graph: never "likely". */
export type PathRole = Extract<FileRole, 'generated' | 'test' | 'config'>
