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

// Fits a text into `maxChars` by cutting its middle, where a field cannot let CSS clip it:
// `…/Markdown_Katex…expressions.0.snap`. The end, the file's extension, keeps a little more.
export function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars || maxChars < 3) {
    return text
  }
  const kept = maxChars - ELLIPSIS.length
  const end = Math.ceil(kept / 2)
  return `${text.slice(0, kept - end)}${ELLIPSIS}${text.slice(text.length - end)}`
}
