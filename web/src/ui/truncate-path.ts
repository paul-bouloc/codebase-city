const ELLIPSIS = '…'

// Shortens a path to at most `maxChars`, cutting folders out of the middle and never the file
// name: `src/vs/…/browser/terminalInstance.ts`. Keeps the first two folders and the last one,
// then drops the last one, then the leading ones. A file name longer than `maxChars` is returned
// whole, after `…/`, for CSS to clip.
export function truncatePath(path: string, maxChars: number): string {
  if (path.length <= maxChars) {
    return path
  }

  const segments = path.split('/')
  const name = segments.pop() ?? ''
  const folders = segments

  const candidates: string[] = []
  if (folders.length > 3) {
    candidates.push([...folders.slice(0, 2), ELLIPSIS, folders.at(-1), name].join('/'))
  }
  if (folders.length > 2) {
    candidates.push([...folders.slice(0, 2), ELLIPSIS, name].join('/'))
  }
  if (folders.length > 1) {
    candidates.push([folders[0], ELLIPSIS, name].join('/'))
  }
  if (folders.length > 0) {
    candidates.push([ELLIPSIS, name].join('/'))
  }

  return candidates.find((candidate) => candidate.length <= maxChars) ?? candidates.at(-1) ?? name
}
