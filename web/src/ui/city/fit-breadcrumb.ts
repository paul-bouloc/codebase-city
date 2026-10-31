// Written between segments, and in place of the dropped ones.
export const SEPARATOR = ' / '
export const ELLIPSIS = '…'

// How many leading folders to hide so the path fits in `maxChars`, written as
// `… / common / model`. The last folder always stays, even when it alone is too long.
export function hiddenFolders(folders: readonly string[], maxChars: number): number {
  const length = (from: number) => {
    const shown = folders.slice(from).join(SEPARATOR).length
    return from === 0 ? shown : ELLIPSIS.length + SEPARATOR.length + shown
  }
  for (let from = 0; from < folders.length; from++) {
    if (length(from) <= maxChars) {
      return from
    }
  }
  return Math.max(0, folders.length - 1)
}
