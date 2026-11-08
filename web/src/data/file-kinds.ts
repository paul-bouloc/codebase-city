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
