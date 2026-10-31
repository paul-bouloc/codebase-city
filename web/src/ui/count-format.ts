const exact = new Intl.NumberFormat('en-US')
const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumSignificantDigits: 2,
})

// "1,204".
export function exactCount(count: number): string {
  return exact.format(count)
}

// At most four characters, for counts in tight places: 999, 1.2k, 12k, 120k, 1.2M.
export function shortCount(count: number): string {
  return count < 1000 ? exact.format(count) : compact.format(count).toLowerCase()
}
