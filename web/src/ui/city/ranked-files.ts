import type { RankedFile } from './sheet-data'

// Rows shown before "Show all (N)".
export const FOLDED_ROWS = 8

// Sorted by importance, the most depended on first; cut at 8 until expanded.
export function rankedRows(
  rows: readonly RankedFile[],
  expanded: boolean,
): { shown: RankedFile[]; total: number; max: number } {
  const sorted = [...rows].sort((a, b) => b.importers - a.importers || a.path.localeCompare(b.path))
  return {
    shown: expanded ? sorted : sorted.slice(0, FOLDED_ROWS),
    total: sorted.length,
    max: sorted[0]?.importers ?? 0,
  }
}
