const ELLIPSIS = '…'

// Shortens a folder path, written with its trailing slash, to at most `maxChars` by dropping
// whole folders from the start: `src/vs/editor/common/model/` becomes `…/common/model/`. Too
// short a budget leaves `…/`, never part of a folder name.
export function shortenFolder(folder: string, maxChars: number): string {
  if (folder.length <= maxChars) {
    return folder
  }
  const segments = folder.split('/').filter(Boolean)
  for (let start = 1; start < segments.length; start++) {
    const candidate = `${ELLIPSIS}/${segments.slice(start).join('/')}/`
    if (candidate.length <= maxChars) {
      return candidate
    }
  }
  return `${ELLIPSIS}/`
}

// Splits a path into its folder, with the trailing slash, and its last name.
export function splitPath(path: string): { folder: string; name: string } {
  const cut = path.lastIndexOf('/') + 1
  return { folder: path.slice(0, cut), name: path.slice(cut) }
}
