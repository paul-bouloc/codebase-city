// The selection lives in the URL's fragment: `#file=src/app.ts` or `#dir=src/core` (spec 04), so
// a link opens the same sheet and the browser's Back and Forward go from one selection to another.

export interface ScreenSelection {
  kind: 'file' | 'dir'
  path: string
}

/** The fragment of a selection; empty for none. Slashes stay readable. */
export function hashOf(selection: ScreenSelection | null): string {
  if (!selection) {
    return ''
  }
  const path = encodeURIComponent(selection.path).replaceAll('%2F', '/')
  return `#${selection.kind}=${path}`
}

/** The selection a fragment names; null for none or for anything else. */
export function selectionOfHash(hash: string): ScreenSelection | null {
  const match = /^#(file|dir)=(.+)$/.exec(hash)
  if (!match?.[1] || !match[2]) {
    return null
  }
  try {
    return { kind: match[1] as ScreenSelection['kind'], path: decodeURIComponent(match[2]) }
  } catch {
    // A broken escape (`%E0`) names nothing.
    return null
  }
}
