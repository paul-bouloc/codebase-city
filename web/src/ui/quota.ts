export const QUOTA_SEGMENTS = 10
const LOW_FROM = 2

export type QuotaTone = 'available' | 'low' | 'exhausted'

export function quotaTone(left: number): QuotaTone {
  if (left <= 0) {
    return 'exhausted'
  }
  return left <= LOW_FROM ? 'low' : 'available'
}

// The gauge always has ten segments, whatever the daily limit; any analysis left shows at least one.
export function filledSegments(left: number, limit: number): number {
  if (left <= 0 || limit <= 0) {
    return 0
  }
  return Math.min(QUOTA_SEGMENTS, Math.max(1, Math.round((left / limit) * QUOTA_SEGMENTS)))
}
